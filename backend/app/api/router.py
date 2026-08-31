import hashlib
import json
import re
from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from sqlalchemy import and_, delete, extract, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..database import engine, get_db, migrate_legacy_schema
from ..models import (Account, Budget, CategorizationRule, Category, ContributionRoom, ExchangeRate, Holding, HouseholdSettings,
                      ImportBatch, InformationNote, Instrument, InvestmentTarget, MarketPrice, MigrationBatch, NetWorthSnapshot, Owner, PlannedItem,
                      PlanKind, RecurringTransaction, RecurringOccurrence, RetirementProfile, SavingsGoal, Transaction, TransactionKind)
from ..schemas import (AccountIn, AccountOut, BudgetIn, BudgetOut, BulkCategorizeIn, BulkDeleteIn, CategoryIn, CategoryOut,
                       ContributionRoomIn, ExchangeRateIn, HoldingIn, ImportCommit, ImportPreview, InformationNoteIn, InstrumentIn,
                       PlannedItemIn, PlannedMonthCopyIn, PriceIn, RecurringConfirmIn, RecurringIn, RuleIn, SavingsGoalIn, TransactionIn,
                       TransactionOut, TransferIn, RetirementProfileIn, HouseholdSettingsIn, InvestmentTargetsIn)
from ..services.imports import apply_investment_purchase, fingerprint, parse_file
from ..services.imports import apply_rules
from ..services.exchange_rates import fetch_cad_rates
from ..services.market_prices import fetch_market_prices
from ..services.backups import create_backup, list_backups, resolve_backup, restore_uploaded_database, database_path

router = APIRouter()


@router.get("/export")
def export_all_data(db: Session = Depends(get_db)):
    models = {
        "accounts": Account, "categories": Category, "import_batches": ImportBatch, "transactions": Transaction,
        "budgets": Budget, "recurring_transactions": RecurringTransaction, "recurring_occurrences": RecurringOccurrence, "categorization_rules": CategorizationRule,
        "instruments": Instrument, "holdings": Holding, "market_prices": MarketPrice, "planned_items": PlannedItem,
        "savings_goals": SavingsGoal, "exchange_rates": ExchangeRate, "contribution_rooms": ContributionRoom,
        "information_notes": InformationNote, "retirement_profiles": RetirementProfile, "migration_batches": MigrationBatch,
        "household_settings": HouseholdSettings, "net_worth_snapshots": NetWorthSnapshot, "investment_targets": InvestmentTarget,
    }
    tables = {}
    for name, model in models.items():
        rows = db.scalars(select(model)).all()
        tables[name] = [{column.name: getattr(row, column.name) for column in model.__table__.columns} for row in rows]
    exported_at = datetime.now(ZoneInfo("America/Toronto"))
    payload = {"format":"mapi-json","version":1,"exported_at":exported_at,"tables":tables}
    filename = f"mapi-export-{exported_at.date().isoformat()}.json"
    return JSONResponse(content=jsonable_encoder(payload), headers={"Content-Disposition":f'attachment; filename="{filename}"'})


@router.get("/export/database")
def export_database_dump():
    if database_path() is None:
        raise HTTPException(409, "El respaldo completo requiere la base local de MAPI Desktop")
    path = create_backup("manual")
    return FileResponse(path, media_type="application/vnd.sqlite3", filename=path.name)


@router.get("/backups")
def backups_index():
    try:
        return list_backups()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/backups", status_code=201)
def backups_create():
    try:
        path = create_backup("manual")
        return {"filename": path.name, "message": "Respaldo creado"}
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/backups/{filename}")
def backups_download(filename: str):
    try:
        path = resolve_backup(filename)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, "No se encontró el respaldo") from exc
    return FileResponse(path, media_type="application/vnd.sqlite3", filename=path.name)


@router.post("/backups/restore")
async def backups_restore(file: UploadFile = File(...)):
    content = await file.read()
    if not content:
        raise HTTPException(422, "El archivo está vacío")
    if len(content) > 1_000_000_000:
        raise HTTPException(413, "El respaldo supera el límite de 1 GB")
    try:
        safety = restore_uploaded_database(content)
        engine.dispose()
        migrate_legacy_schema()
        return {"message": "Datos restaurados", "safety_backup": safety.name}
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(422, str(exc)) from exc


def month_bounds(value: str | None) -> tuple[date, date]:
    try:
        start = datetime.strptime(value, "%Y-%m").date() if value else date.today().replace(day=1)
    except ValueError as exc:
        raise HTTPException(422, "month must use YYYY-MM") from exc
    end = date(start.year + (start.month == 12), 1 if start.month == 12 else start.month + 1, 1)
    return start, end


def latest_rate(db: Session, currency: str, as_of: date | None = None) -> Decimal | None:
    if currency == "CAD": return Decimal("1")
    query = select(ExchangeRate.rate).where(ExchangeRate.from_currency == currency, ExchangeRate.to_currency == "CAD")
    if as_of: query = query.where(ExchangeRate.date <= as_of)
    return db.scalar(query.order_by(ExchangeRate.date.desc()).limit(1))


def latest_market_price(db: Session, instrument_id: str) -> MarketPrice | None:
    source_tag = f"yahoo:{datetime.now(ZoneInfo('America/Toronto')).date().isoformat()}"
    return db.scalar(select(MarketPrice).where(MarketPrice.instrument_id == instrument_id).order_by(
        (MarketPrice.source == source_tag).desc(), MarketPrice.date.desc()
    ).limit(1))


@router.get("/health")
def health():
    return {"status": "ok"}


def account_values(db: Session, items: list[Account]) -> list[AccountOut]:
    transaction_balances = dict(db.execute(
        select(Transaction.account_id, func.coalesce(func.sum(Transaction.amount), 0))
        .group_by(Transaction.account_id)
    ).all())
    holding_values: dict[tuple[str, str], Decimal] = {}
    for holding in db.scalars(select(Holding).options(joinedload(Holding.instrument))).all():
        price = latest_market_price(db, holding.instrument_id)
        if price:
            key = (holding.account_id, holding.instrument.currency)
            holding_values[key] = holding_values.get(key, Decimal("0")) + holding.quantity * price.price
    output = []
    for item in items:
        cash = item.opening_balance + transaction_balances.get(item.id, 0)
        invested = holding_values.get((item.id, item.currency), Decimal("0"))
        output.append(AccountOut.model_validate(item).model_copy(update={
            "cash_balance": cash, "holdings_balance": invested, "balance": cash + invested,
        }))
    return output


@router.get("/accounts", response_model=list[AccountOut])
def accounts(include_archived: bool = False, db: Session = Depends(get_db)):
    query = select(Account)
    if not include_archived: query = query.where(Account.archived.is_(False))
    items = db.scalars(query.order_by(Account.archived, Account.name)).all()
    return account_values(db, list(items))


@router.post("/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountIn, db: Session = Depends(get_db)):
    item = Account(**payload.model_dump())
    db.add(item); db.commit(); db.refresh(item)
    return account_values(db, [item])[0]


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def update_account(account_id: str, payload: AccountIn, db: Session = Depends(get_db)):
    item = db.get(Account, account_id)
    if not item: raise HTTPException(404, "Account not found")
    has_transactions = db.scalar(select(Transaction.id).where(Transaction.account_id == account_id).limit(1))
    if has_transactions and payload.currency != item.currency:
        raise HTTPException(409, "La moneda no puede cambiarse porque la cuenta tiene movimientos")
    for key, value in payload.model_dump().items(): setattr(item, key, value or None if key in {"institution", "account_subtype"} else value)
    db.commit(); db.refresh(item)
    return account_values(db, [item])[0]


@router.patch("/accounts/{account_id}/archive", response_model=AccountOut)
def archive_account(account_id: str, archived: bool = True, db: Session = Depends(get_db)):
    item = db.get(Account, account_id)
    if not item: raise HTTPException(404, "Account not found")
    item.archived = archived
    db.commit(); db.refresh(item)
    return account_values(db, [item])[0]


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: str, db: Session = Depends(get_db)):
    item = db.get(Account, account_id)
    if not item: raise HTTPException(404, "Account not found")
    transfer_ids = list(db.scalars(select(Transaction.transfer_id).where(
        Transaction.account_id == account_id, Transaction.transfer_id.is_not(None)).distinct()).all())
    if transfer_ids: db.execute(delete(Transaction).where(Transaction.transfer_id.in_(transfer_ids)))
    db.execute(delete(Transaction).where(Transaction.account_id == account_id))
    db.execute(delete(Holding).where(Holding.account_id == account_id))
    recurring_ids = list(db.scalars(select(RecurringTransaction.id).where(RecurringTransaction.account_id == account_id)).all())
    if recurring_ids: db.execute(delete(RecurringOccurrence).where(RecurringOccurrence.recurring_id.in_(recurring_ids)))
    db.execute(delete(RecurringTransaction).where(RecurringTransaction.account_id == account_id))
    db.execute(delete(ImportBatch).where(ImportBatch.account_id == account_id))
    db.execute(update(PlannedItem).where(PlannedItem.account_id == account_id).values(account_id=None))
    db.execute(update(SavingsGoal).where(SavingsGoal.account_id == account_id).values(account_id=None))
    db.delete(item); db.commit()


@router.get("/categories", response_model=list[CategoryOut])
def categories(db: Session = Depends(get_db)):
    return db.scalars(select(Category).order_by(Category.is_income, Category.name)).all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryIn, db: Session = Depends(get_db)):
    item = Category(**payload.model_dump()); db.add(item)
    if payload.parent_id:
        parent = db.get(Category, payload.parent_id)
        if not parent: raise HTTPException(404, "Parent category not found")
        parent.is_essential = None
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, "Category already exists")
    db.refresh(item); return item


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(category_id: str, payload: CategoryIn, db: Session = Depends(get_db)):
    item = db.get(Category, category_id)
    if not item: raise HTTPException(404, "Category not found")
    if payload.parent_id == category_id: raise HTTPException(422, "Una categoría no puede ser su propio grupo")
    if payload.parent_id and not db.get(Category, payload.parent_id): raise HTTPException(404, "Parent category not found")
    data = payload.model_dump()
    if db.scalar(select(Category.id).where(Category.parent_id == category_id).limit(1)): data["is_essential"] = None
    for key, value in data.items(): setattr(item, key, value)
    if payload.parent_id: db.get(Category, payload.parent_id).is_essential = None
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, "Ya existe una categoría con ese nombre")
    db.refresh(item); return item


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: str, db: Session = Depends(get_db)):
    item = db.get(Category, category_id)
    if not item: raise HTTPException(404, "Category not found")
    db.execute(update(Transaction).where(Transaction.category_id == category_id).values(category_id=None))
    db.execute(update(RecurringTransaction).where(RecurringTransaction.category_id == category_id).values(category_id=None))
    db.execute(update(PlannedItem).where(PlannedItem.category_id == category_id).values(category_id=None))
    db.execute(update(Category).where(Category.parent_id == category_id).values(parent_id=None))
    db.execute(delete(Budget).where(Budget.category_id == category_id))
    db.execute(delete(CategorizationRule).where(CategorizationRule.category_id == category_id))
    db.delete(item); db.commit()


@router.get("/transactions", response_model=list[TransactionOut])
def transactions(account_id: str | None = None, month: str | None = None, limit: int = 200, db: Session = Depends(get_db)):
    query = select(Transaction).options(joinedload(Transaction.account), joinedload(Transaction.category))
    if account_id: query = query.where(Transaction.account_id == account_id)
    if month:
        start, end = month_bounds(month); query = query.where(Transaction.date >= start, Transaction.date < end)
    return db.scalars(query.order_by(Transaction.date.desc(), Transaction.created_at.desc()).limit(min(limit, 1000))).all()


@router.post("/transactions", response_model=TransactionOut, status_code=201)
def create_transaction(payload: TransactionIn, db: Session = Depends(get_db)):
    account = db.get(Account, payload.account_id)
    if not account: raise HTTPException(404, "Account not found")
    data = payload.model_dump()
    data["currency"] = account.currency
    kind = data.pop("kind") or (TransactionKind.income if payload.amount >= 0 else TransactionKind.expense)
    item = Transaction(**data, kind=kind, fingerprint=fingerprint(payload.account_id, payload.date, payload.amount, payload.description))
    db.add(item)
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, "Duplicate transaction")
    return db.scalar(select(Transaction).options(joinedload(Transaction.account), joinedload(Transaction.category)).where(Transaction.id == item.id))


@router.patch("/transactions/{transaction_id}", response_model=TransactionOut)
def update_transaction(transaction_id: str, payload: TransactionIn, db: Session = Depends(get_db)):
    item = db.get(Transaction, transaction_id)
    if not item: raise HTTPException(404, "Transaction not found")
    if item.transfer_id: raise HTTPException(409, "Linked transfers must be deleted and recreated")
    account = db.get(Account, payload.account_id)
    if not account: raise HTTPException(404, "Account not found")
    item.account_id, item.category_id = payload.account_id, payload.category_id
    item.date, item.amount, item.currency = payload.date, payload.amount, account.currency
    item.description, item.payee, item.notes = payload.description, payload.payee, payload.notes
    item.kind = payload.kind or (TransactionKind.income if payload.amount >= 0 else TransactionKind.expense)
    item.fingerprint = fingerprint(payload.account_id, payload.date, payload.amount, payload.description, item.external_id)
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, "Another transaction already has these details")
    return db.scalar(select(Transaction).options(joinedload(Transaction.account), joinedload(Transaction.category)).where(Transaction.id == item.id))


@router.delete("/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: str, db: Session = Depends(get_db)):
    item = db.get(Transaction, transaction_id)
    if not item: raise HTTPException(404, "Transaction not found")
    if item.transfer_id:
        for linked in db.scalars(select(Transaction).where(Transaction.transfer_id == item.transfer_id)).all(): db.delete(linked)
    else: db.delete(item)
    db.commit()


@router.post("/transfers", status_code=201)
def create_transfer(payload: TransferIn, db: Session = Depends(get_db)):
    source, target = db.get(Account, payload.from_account_id), db.get(Account, payload.to_account_id)
    if not source or not target: raise HTTPException(404, "Account not found")
    if source.id == target.id: raise HTTPException(422, "Source and destination accounts must be different")
    if source.currency != target.currency and payload.received_amount is None and payload.exchange_rate is None:
        raise HTTPException(422, "Cross-currency transfers require received_amount or exchange_rate")
    received = payload.amount if source.currency == target.currency else (payload.received_amount or payload.amount * payload.exchange_rate)
    transfer_id = hashlib.sha256(f"{payload.from_account_id}{payload.to_account_id}{payload.date}{datetime.utcnow()}".encode()).hexdigest()[:36]
    result = []
    for account, amount in ((source, -payload.amount), (target, received)):
        item = Transaction(account_id=account.id, date=payload.date, amount=amount, currency=account.currency,
                           description=payload.description, kind=TransactionKind.transfer, transfer_id=transfer_id,
                           fingerprint=fingerprint(account.id, payload.date, amount, f"{payload.description}:{transfer_id}"))
        db.add(item); result.append(item)
    db.commit(); return {"transfer_id": transfer_id, "transaction_ids": [item.id for item in result],
                         "sent": payload.amount, "received": received,
                         "from_currency": source.currency, "to_currency": target.currency}


@router.get("/budgets", response_model=list[BudgetOut])
def budgets(month: str | None = None, db: Session = Depends(get_db)):
    start, end = month_bounds(month)
    items = db.scalars(select(Budget).options(joinedload(Budget.category)).where(Budget.month == start)).all()
    spent = {(category_id, currency): amount for category_id, currency, amount in db.execute(select(
        Transaction.category_id, Transaction.currency, -func.sum(Transaction.amount)).where(
        Transaction.date >= start, Transaction.date < end, Transaction.kind == TransactionKind.expense,
        Transaction.category_id.is_not(None)
    ).group_by(Transaction.category_id, Transaction.currency)).all()}
    if items:
        return [BudgetOut.model_validate(item).model_copy(update={"spent": spent.get((item.category_id, item.currency), 0)}) for item in items]

    # PlannedItem is the source of truth for projected monthly budgets, avoiding
    # a second, duplicated budget table.
    planned = db.execute(select(
        func.min(PlannedItem.id), PlannedItem.category_id, PlannedItem.currency, func.sum(PlannedItem.amount)
    ).where(
        PlannedItem.year == start.year, PlannedItem.month == start.month,
        PlannedItem.kind == PlanKind.expense, PlannedItem.category_id.is_not(None)
    ).group_by(PlannedItem.category_id, PlannedItem.currency)).all()
    categories = {item.id: item for item in db.scalars(select(Category)).all()}
    result = [{"id": item_id, "month": start, "category_id": category_id, "amount": amount,
               "currency": currency, "category": categories[category_id], "spent": spent.get((category_id, currency), 0)}
              for item_id, category_id, currency, amount in planned if category_id in categories]
    planned_keys = {(row["category_id"], row["currency"]) for row in result}
    result.extend({"id": f"actual-{category_id}-{currency}", "month": start, "category_id": category_id,
                   "amount": Decimal("0"), "currency": currency, "category": categories[category_id], "spent": amount}
                  for (category_id, currency), amount in spent.items()
                  if (category_id, currency) not in planned_keys and category_id in categories)
    return result


@router.post("/budgets", response_model=BudgetOut, status_code=201)
def upsert_budget(payload: BudgetIn, db: Session = Depends(get_db)):
    month = payload.month.replace(day=1)
    item = db.scalar(select(Budget).where(Budget.month == month, Budget.category_id == payload.category_id))
    if item: item.amount, item.currency = payload.amount, payload.currency
    else: item = Budget(**payload.model_dump(exclude={"month"}), month=month); db.add(item)
    db.commit()
    return BudgetOut.model_validate(db.scalar(select(Budget).options(joinedload(Budget.category)).where(Budget.id == item.id)))


def next_recurrence(current: date, frequency: str) -> date:
    if frequency == "weekly": return current + timedelta(days=7)
    if frequency == "biweekly": return current + timedelta(days=14)
    if frequency == "yearly":
        return current.replace(year=current.year + 1, day=min(current.day, monthrange(current.year + 1, current.month)[1]))
    month = current.month + 1
    year = current.year + (month > 12)
    month = 1 if month > 12 else month
    return date(year, month, min(current.day, monthrange(year, month)[1]))


def materialize_occurrences(db: Session, through: date) -> None:
    for recurring_item in db.scalars(select(RecurringTransaction).where(RecurringTransaction.active.is_(True))).all():
        scheduled = recurring_item.next_date
        guard = 0
        while scheduled <= through and guard < 1000:
            exists = db.scalar(select(RecurringOccurrence.id).where(
                RecurringOccurrence.recurring_id == recurring_item.id,
                RecurringOccurrence.scheduled_date == scheduled,
            ))
            if not exists: db.add(RecurringOccurrence(recurring_id=recurring_item.id, scheduled_date=scheduled))
            scheduled = next_recurrence(scheduled, recurring_item.frequency); guard += 1
    db.commit()


@router.get("/recurring")
def recurring(db: Session = Depends(get_db)):
    return db.scalars(select(RecurringTransaction).order_by(RecurringTransaction.active.desc(), RecurringTransaction.next_date)).all()


@router.post("/recurring", status_code=201)
def create_recurring(payload: RecurringIn, db: Session = Depends(get_db)):
    if not db.get(Account, payload.account_id): raise HTTPException(404, "Account not found")
    if payload.category_id and not db.get(Category, payload.category_id): raise HTTPException(404, "Category not found")
    item = RecurringTransaction(**payload.model_dump()); db.add(item); db.commit(); db.refresh(item); return item


@router.patch("/recurring/{recurring_id}")
def update_recurring(recurring_id: str, payload: RecurringIn, db: Session = Depends(get_db)):
    item = db.get(RecurringTransaction, recurring_id)
    if not item: raise HTTPException(404, "Scheduled transaction not found")
    if not db.get(Account, payload.account_id): raise HTTPException(404, "Account not found")
    if payload.category_id and not db.get(Category, payload.category_id): raise HTTPException(404, "Category not found")
    db.execute(delete(RecurringOccurrence).where(
        RecurringOccurrence.recurring_id == item.id, RecurringOccurrence.status == "pending"
    ))
    for key, value in payload.model_dump().items(): setattr(item, key, value)
    db.commit(); db.refresh(item); return item


@router.delete("/recurring/{recurring_id}", status_code=204)
def delete_recurring(recurring_id: str, db: Session = Depends(get_db)):
    item = db.get(RecurringTransaction, recurring_id)
    if not item: raise HTTPException(404, "Scheduled transaction not found")
    db.execute(delete(RecurringOccurrence).where(RecurringOccurrence.recurring_id == item.id))
    db.delete(item); db.commit()


@router.get("/recurring/calendar")
def recurring_calendar(month: str | None = None, db: Session = Depends(get_db)):
    start, end = month_bounds(month)
    materialize_occurrences(db, end - timedelta(days=1))
    occurrences = db.scalars(
        select(RecurringOccurrence).options(joinedload(RecurringOccurrence.recurring))
        .where(or_(
            and_(RecurringOccurrence.scheduled_date >= start, RecurringOccurrence.scheduled_date < end),
            and_(RecurringOccurrence.status == "pending", RecurringOccurrence.scheduled_date < start),
        )).order_by(RecurringOccurrence.scheduled_date)
    ).all()
    linked_ids = set(db.scalars(select(RecurringOccurrence.transaction_id).where(RecurringOccurrence.transaction_id.is_not(None))).all())
    output = []
    for occurrence in occurrences:
        item = occurrence.recurring
        candidates = []
        if occurrence.status == "pending":
            matches = db.scalars(select(Transaction).where(
                Transaction.account_id == item.account_id,
                Transaction.amount == item.amount,
                Transaction.date >= occurrence.scheduled_date - timedelta(days=5),
                Transaction.date <= occurrence.scheduled_date + timedelta(days=5),
            ).order_by(Transaction.date).limit(3)).all()
            candidates = [{"id": tx.id, "date": tx.date, "description": tx.description, "amount": tx.amount} for tx in matches if tx.id not in linked_ids]
        output.append({
            "id": occurrence.id, "recurring_id": item.id, "scheduled_date": occurrence.scheduled_date,
            "status": occurrence.status, "transaction_id": occurrence.transaction_id,
            "description": item.description, "amount": item.amount, "currency": item.currency,
            "frequency": item.frequency, "account_id": item.account_id, "category_id": item.category_id,
            "candidates": candidates,
        })
    pending = [row for row in output if row["status"] == "pending"]
    return {"month": start.strftime("%Y-%m"), "occurrences": output,
            "pending_income": sum((row["amount"] for row in pending if row["amount"] > 0), Decimal("0")),
            "pending_expenses": sum((-row["amount"] for row in pending if row["amount"] < 0), Decimal("0"))}


@router.get("/attention")
def attention_center(db: Session = Depends(get_db)):
    today_value = datetime.now(ZoneInfo("America/Toronto")).date()
    materialize_occurrences(db, today_value + timedelta(days=7))
    alerts = []
    overdue = db.scalar(select(func.count()).select_from(RecurringOccurrence).where(
        RecurringOccurrence.status == "pending", RecurringOccurrence.scheduled_date < today_value
    )) or 0
    upcoming = db.scalar(select(func.count()).select_from(RecurringOccurrence).where(
        RecurringOccurrence.status == "pending", RecurringOccurrence.scheduled_date >= today_value,
        RecurringOccurrence.scheduled_date <= today_value + timedelta(days=7)
    )) or 0
    if overdue:
        alerts.append({"type":"scheduled_overdue","severity":"critical","target":"scheduled","count":overdue,
                       "title":f"{overdue} programado{'s' if overdue != 1 else ''} vencido{'s' if overdue != 1 else ''}",
                       "detail":"Confirmalos, vinculalos con movimientos importados u omitilos."})
    if upcoming:
        alerts.append({"type":"scheduled_upcoming","severity":"info","target":"scheduled","count":upcoming,
                       "title":f"{upcoming} movimiento{'s' if upcoming != 1 else ''} esperado{'s' if upcoming != 1 else ''} esta semana",
                       "detail":"Revisá que haya saldo suficiente y confirmalos cuando sucedan."})

    uncategorized = db.scalar(select(func.count()).select_from(Transaction).where(
        Transaction.category_id.is_(None), Transaction.kind != TransactionKind.transfer,
        ~Transaction.description.startswith("Ajuste de saldo por carga histórica"),
        Transaction.date >= today_value - timedelta(days=90)
    )) or 0
    if uncategorized:
        alerts.append({"type":"uncategorized","severity":"warning","target":"transactions","count":uncategorized,
                       "title":f"{uncategorized} movimiento{'s' if uncategorized != 1 else ''} sin categoría",
                       "detail":"Son de los últimos 90 días y reducen la precisión del presupuesto."})

    duplicate_groups = db.execute(select(
        Transaction.account_id, Account.name, Transaction.date, Transaction.amount,
        Transaction.currency, Transaction.description, func.count(Transaction.id)
    ).join(Account, Account.id == Transaction.account_id
    ).where(Transaction.kind != TransactionKind.transfer, Transaction.date >= today_value - timedelta(days=90))
      .group_by(
          Transaction.account_id, Account.name, Transaction.date, Transaction.amount,
          Transaction.currency, Transaction.description
      ).having(func.count(Transaction.id) > 1)).all()
    if duplicate_groups:
        examples = "; ".join(
            f"{row.name}: {row.description} · {row.date.strftime('%d/%m')} · {row.amount} {row.currency}"
            for row in duplicate_groups[:3]
        )
        alerts.append({"type":"duplicates","severity":"warning","target":"transactions","count":len(duplicate_groups),
                       "title":f"{len(duplicate_groups)} posible{'s' if len(duplicate_groups) != 1 else ''} duplicado{'s' if len(duplicate_groups) != 1 else ''}",
                       "detail":examples})

    variance = budget_variance(year=today_value.year, month=today_value.month, db=db)
    over_rows = [row for row in variance["rows"] if row["status"] == "over" and row["projected"] > 0]
    if over_rows:
        amount = sum((row["variance"] for row in over_rows), Decimal("0"))
        examples = "; ".join(
            f"{row['category']}: {row['actual'].quantize(Decimal('0.01'))} de {row['projected'].quantize(Decimal('0.01'))} {row['currency']}"
            for row in over_rows[:3]
        )
        alerts.append({"type":"budget_over","severity":"warning","target":"plan","count":len(over_rows),
                       "title":f"{len(over_rows)} partida{'s' if len(over_rows) != 1 else ''} sobre el presupuesto",
                       "detail":f"{examples}. Desvío: +{amount.quantize(Decimal('0.01'))} CAD."})

    rooms = db.scalars(select(ContributionRoom).where(ContributionRoom.year == today_value.year, ContributionRoom.limit_amount > 0)).all()
    near_rooms = [room for room in rooms if room.contributed_amount / room.limit_amount >= Decimal("0.90")]
    if near_rooms:
        names = ", ".join(f"{room.account_type} {room.owner.value.title()}" for room in near_rooms[:3])
        alerts.append({"type":"contribution_room","severity":"info","target":"investments","count":len(near_rooms),
                       "title":"Límites de aporte cerca de completarse","detail":names})

    held_instruments = db.scalars(
        select(Instrument).join(Holding).where(Holding.quantity != 0).distinct()
    ).all()
    stale = []
    for instrument in held_instruments:
        price_date = db.scalar(select(func.max(MarketPrice.date)).where(MarketPrice.instrument_id == instrument.id))
        if price_date is None or price_date < today_value - timedelta(days=7): stale.append(instrument.symbol)
    if stale:
        alerts.append({"type":"stale_prices","severity":"info","target":"investments","count":len(stale),
                       "title":f"{len(stale)} precio{'s' if len(stale) != 1 else ''} de inversión desactualizado{'s' if len(stale) != 1 else ''}",
                       "detail":", ".join(stale[:5])})

    severity_order = {"critical":0,"warning":1,"info":2}
    alerts.sort(key=lambda alert: severity_order[alert["severity"]])
    health = max(0, 100 - min(24, overdue * 8) - min(20, uncategorized // 10) -
                 min(15, len(duplicate_groups) * 2) - min(10, len(stale)))
    return {"date":today_value,"alerts":alerts,"health_score":health,
            "summary":{"critical":sum(a["severity"]=="critical" for a in alerts),
                       "warning":sum(a["severity"]=="warning" for a in alerts),
                       "info":sum(a["severity"]=="info" for a in alerts)}}


@router.post("/recurring/occurrences/{occurrence_id}/confirm")
def confirm_occurrence(occurrence_id: str, payload: RecurringConfirmIn, db: Session = Depends(get_db)):
    occurrence = db.scalar(select(RecurringOccurrence).options(joinedload(RecurringOccurrence.recurring)).where(RecurringOccurrence.id == occurrence_id))
    if not occurrence: raise HTTPException(404, "Scheduled occurrence not found")
    if occurrence.status != "pending": raise HTTPException(409, "This occurrence was already resolved")
    item = occurrence.recurring
    if payload.transaction_id:
        transaction = db.get(Transaction, payload.transaction_id)
        if not transaction or transaction.account_id != item.account_id: raise HTTPException(422, "The transaction does not match this account")
        if db.scalar(select(RecurringOccurrence.id).where(RecurringOccurrence.transaction_id == transaction.id)):
            raise HTTPException(409, "That transaction is already linked")
    else:
        actual_date = payload.actual_date or occurrence.scheduled_date
        amount = payload.actual_amount if payload.actual_amount is not None else item.amount
        transaction = Transaction(
            account_id=item.account_id, category_id=item.category_id, date=actual_date, amount=amount,
            currency=item.currency, description=item.description,
            kind=TransactionKind.income if amount >= 0 else TransactionKind.expense,
            notes="Confirmado desde Programados",
            fingerprint=hashlib.sha256(f"scheduled|{occurrence.id}|{actual_date}|{amount}".encode()).hexdigest(),
        )
        db.add(transaction); db.flush()
    occurrence.status = "confirmed"; occurrence.transaction_id = transaction.id; occurrence.confirmed_at = datetime.utcnow()
    db.commit()
    return {"occurrence_id": occurrence.id, "transaction_id": transaction.id, "status": occurrence.status}


@router.post("/recurring/occurrences/{occurrence_id}/skip")
def skip_occurrence(occurrence_id: str, db: Session = Depends(get_db)):
    occurrence = db.get(RecurringOccurrence, occurrence_id)
    if not occurrence: raise HTTPException(404, "Scheduled occurrence not found")
    if occurrence.status != "pending": raise HTTPException(409, "This occurrence was already resolved")
    occurrence.status = "skipped"; occurrence.confirmed_at = datetime.utcnow(); db.commit()
    return {"occurrence_id": occurrence.id, "status": occurrence.status}

@router.get("/rules")
def rules(db: Session = Depends(get_db)): return db.scalars(select(CategorizationRule).order_by(CategorizationRule.priority)).all()

@router.post("/rules", status_code=201)
def create_rule(payload: RuleIn, db: Session = Depends(get_db)):
    if not db.get(Category, payload.category_id): raise HTTPException(404, "Category not found")
    item = CategorizationRule(**payload.model_dump()); db.add(item); db.commit(); db.refresh(item); return item

@router.patch("/rules/{rule_id}")
def update_rule(rule_id: str, payload: RuleIn, db: Session = Depends(get_db)):
    item = db.get(CategorizationRule, rule_id)
    if not item: raise HTTPException(404, "Rule not found")
    if not db.get(Category, payload.category_id): raise HTTPException(404, "Category not found")
    for key, value in payload.model_dump().items(): setattr(item, key, value)
    db.commit(); db.refresh(item); return item

@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: str, db: Session = Depends(get_db)):
    item = db.get(CategorizationRule, rule_id)
    if not item: raise HTTPException(404, "Rule not found")
    db.delete(item); db.commit()


def merchant_key(value: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9]+", " ", value.upper())
    cleaned = re.sub(r"\b\d{3,}\b", " ", cleaned)
    ignored = {"ON", "BC", "QC", "AB", "CA", "CANADA"}
    tokens = [token for token in cleaned.split() if token not in ignored]
    return " ".join(tokens[:5]) or value.upper().strip()


@router.get("/categorization/review")
def categorization_review(db: Session = Depends(get_db)):
    uncategorized = db.scalars(select(Transaction).where(
        Transaction.category_id.is_(None), Transaction.kind != TransactionKind.transfer,
        ~Transaction.description.startswith("Ajuste de saldo por carga histórica")
    ).order_by(Transaction.date.desc())).all()
    categorized = db.scalars(select(Transaction).where(
        Transaction.category_id.is_not(None), Transaction.kind != TransactionKind.transfer
    )).all()
    history: dict[str, dict[str, int]] = {}
    history_amount: dict[tuple[str, Decimal], dict[str, int]] = {}
    for item in categorized:
        key = merchant_key(item.description)
        votes = history.setdefault(key, {})
        votes[item.category_id] = votes.get(item.category_id, 0) + 1
        amount_votes = history_amount.setdefault((key, item.amount), {})
        amount_votes[item.category_id] = amount_votes.get(item.category_id, 0) + 1
    ambiguous = {key for key, votes in history.items() if len(votes) > 1}
    groups: dict[tuple[str, str, str, Decimal | None], list[Transaction]] = {}
    for item in uncategorized:
        key = merchant_key(item.description)
        amount_key = item.amount if key in ambiguous else None
        groups.setdefault((key, item.currency, item.kind.value, amount_key), []).append(item)
    output = []
    for (key, currency, kind, amount_key), items in groups.items():
        votes = history_amount.get((key, amount_key), {}) if amount_key is not None else history.get(key, {})
        category_id = max(votes, key=votes.get) if votes else None
        confidence = Decimal(max(votes.values())) / Decimal(sum(votes.values())) if votes else Decimal("0")
        source = "historial" if votes else None
        if not category_id:
            sample = items[0]
            category_id = apply_rules(db, sample.description, sample.payee, account_id=sample.account_id,
                                      amount=sample.amount, currency=sample.currency, kind=sample.kind)
            if category_id: confidence, source = Decimal("0.98"), "regla"
        output.append({"key":f"{key} · {amount_key}" if amount_key is not None else key,"description":items[0].description,"count":len(items),
                       "transaction_ids":[item.id for item in items],"currency":currency,"kind":kind,
                       "account_id":items[0].account_id,"amount":items[0].amount,
                       "same_amount":all(item.amount == items[0].amount for item in items),
                       "suggested_category_id":category_id,"confidence":confidence,"source":source,
                       "examples":[{"id":item.id,"date":item.date,"description":item.description,"amount":item.amount} for item in items[:3]]})
    output.sort(key=lambda group: (-group["count"], group["description"]))
    return {"groups":output,"transactions":len(uncategorized)}


@router.post("/categorization/apply")
def bulk_categorize(payload: BulkCategorizeIn, db: Session = Depends(get_db)):
    category = db.get(Category, payload.category_id)
    if not category: raise HTTPException(404, "Category not found")
    items = db.scalars(select(Transaction).where(
        Transaction.id.in_(payload.transaction_ids), Transaction.kind != TransactionKind.transfer
    )).all()
    if not items: raise HTTPException(404, "No transactions found")
    for item in items: item.category_id = category.id
    rule_id = None
    if payload.create_rule:
        first = items[0]
        value = (payload.rule_value or first.description).strip()
        existing = db.scalar(select(CategorizationRule).where(
            func.upper(CategorizationRule.value) == value.upper(),
            CategorizationRule.account_id == (first.account_id if payload.match_account else None),
            CategorizationRule.amount == (first.amount if payload.match_amount else None),
        ))
        if existing:
            existing.category_id = category.id; existing.active = True; rule_id = existing.id
        else:
            rule = CategorizationRule(name=payload.rule_name or value[:120], field="description",
                operator=payload.operator, value=value, category_id=category.id, priority=50, active=True,
                amount=first.amount if payload.match_amount else None,
                currency=first.currency if payload.match_currency else None,
                account_id=first.account_id if payload.match_account else None,
                transaction_kind=first.kind if payload.match_kind else None)
            db.add(rule); db.flush(); rule_id = rule.id
    db.commit()
    return {"updated":len(items),"rule_id":rule_id}


@router.post("/categorization/delete")
def bulk_delete_transactions(payload: BulkDeleteIn, db: Session = Depends(get_db)):
    items = db.scalars(select(Transaction).where(Transaction.id.in_(payload.transaction_ids))).all()
    if not items: raise HTTPException(404, "No transactions found")
    transfer_ids = {item.transfer_id for item in items if item.transfer_id}
    if transfer_ids:
        db.execute(delete(Transaction).where(Transaction.transfer_id.in_(transfer_ids)))
    plain_ids = [item.id for item in items if not item.transfer_id]
    if plain_ids: db.execute(delete(Transaction).where(Transaction.id.in_(plain_ids)))
    db.commit()
    return {"deleted":len(items)}


@router.post("/imports/preview", response_model=ImportPreview)
async def import_preview(account_id: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not db.get(Account, account_id): raise HTTPException(404, "Account not found")
    content = await file.read()
    if len(content) > 10_000_000: raise HTTPException(413, "File exceeds 10 MB")
    file_hash = hashlib.sha256(content + account_id.encode()).hexdigest()
    try: detected, rows = parse_file(file.filename or "upload", content, account_id, db)
    except (ValueError, UnicodeDecodeError) as exc: raise HTTPException(422, str(exc)) from exc
    return ImportPreview(token=file_hash, filename=file.filename or "upload", file_hash=file_hash, rows=rows, detected_format=detected)


@router.post("/imports/commit")
def import_commit(payload: ImportCommit, db: Session = Depends(get_db)):
    if db.scalar(select(ImportBatch.id).where(ImportBatch.file_hash == payload.file_hash)):
        raise HTTPException(409, "This file was already imported")
    batch = ImportBatch(filename=payload.filename, file_hash=payload.file_hash, account_id=payload.account_id)
    db.add(batch); db.flush(); imported = skipped = 0
    for row in payload.rows:
        if row.duplicate: skipped += 1; continue
        account=db.get(Account, payload.account_id)
        if row.currency and row.currency != account.currency:
            skipped += 1
            continue
        item = Transaction(account_id=payload.account_id, category_id=row.category_id, date=row.date, amount=row.amount,
                           currency=row.currency or account.currency, description=row.description, payee=row.payee,
                           kind=row.kind or (TransactionKind.income if row.amount >= 0 else TransactionKind.expense),
                           external_id=row.external_id, fingerprint=row.fingerprint, import_batch_id=batch.id)
        db.add(item); imported += 1
        apply_investment_purchase(db, payload.account_id, row.date, row.description, row.currency or account.currency)
    batch.imported_count, batch.skipped_count = imported, skipped
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, "One or more rows already exist")
    return {"batch_id": batch.id, "imported": imported, "skipped": skipped}


@router.get("/instruments")
def instruments(db: Session = Depends(get_db)): return db.scalars(select(Instrument).order_by(Instrument.symbol)).all()

@router.post("/instruments", status_code=201)
def create_instrument(payload: InstrumentIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    data["symbol"] = payload.symbol.upper()
    item = Instrument(**data); db.add(item); db.commit(); db.refresh(item); return item

@router.get("/holdings")
def holdings(db: Session = Depends(get_db)):
    items = db.scalars(select(Holding).join(Account).where(Account.archived.is_(False)).options(joinedload(Holding.instrument), joinedload(Holding.account))).all()
    output = []
    for item in items:
        latest = latest_market_price(db, item.instrument_id)
        output.append({"id": item.id, "account_id": item.account_id, "account_name": item.account.name,
                       "instrument_id": item.instrument_id, "symbol": item.instrument.symbol, "name": item.instrument.name,
                       "currency": item.instrument.currency, "quantity": item.quantity, "average_cost": item.average_cost,
                       "price": latest.price if latest else None, "price_date": latest.date if latest else None,
                       "price_source": latest.source if latest else None,
                       "value": item.quantity * latest.price if latest else None})
    return output

@router.post("/holdings", status_code=201)
def upsert_holding(payload: HoldingIn, db: Session = Depends(get_db)):
    item = db.scalar(select(Holding).where(Holding.account_id == payload.account_id, Holding.instrument_id == payload.instrument_id))
    if item: item.quantity, item.average_cost = payload.quantity, payload.average_cost
    else: item = Holding(**payload.model_dump()); db.add(item)
    db.commit(); db.refresh(item); return item


@router.delete("/holdings/{holding_id}", status_code=204)
def delete_holding(holding_id: str, db: Session = Depends(get_db)):
    item = db.get(Holding, holding_id)
    if not item: raise HTTPException(404, "Holding not found")
    db.delete(item); db.commit()

@router.post("/market-prices", status_code=201)
def create_price(payload: PriceIn, db: Session = Depends(get_db)):
    item = db.scalar(select(MarketPrice).where(MarketPrice.instrument_id == payload.instrument_id, MarketPrice.date == payload.date))
    if item:
        item.price, item.currency, item.source = payload.price, payload.currency, payload.source
    else:
        item = MarketPrice(**payload.model_dump()); db.add(item)
    db.commit()
    db.refresh(item); return item


@router.post("/market-prices/refresh")
def refresh_market_prices(force: bool = False, db: Session = Depends(get_db)):
    today_value = datetime.now(ZoneInfo("America/Toronto")).date()
    source_tag = f"yahoo:{today_value.isoformat()}"
    instruments = db.scalars(select(Instrument).join(Holding).distinct().order_by(Instrument.symbol)).all()
    cached = db.scalar(select(func.count()).select_from(MarketPrice).where(MarketPrice.source == source_tag)) or 0
    if not force and cached >= len(instruments):
        latest_date = db.scalar(select(func.max(MarketPrice.date)).where(MarketPrice.source == source_tag))
        return {"status":"cached","updated":0,"as_of":latest_date,"errors":[]}
    fetched, errors = fetch_market_prices([
        {"id": item.id, "symbol": item.symbol, "currency": item.currency} for item in instruments
    ])
    for data in fetched:
        item = db.scalar(select(MarketPrice).where(
            MarketPrice.instrument_id == data["instrument_id"], MarketPrice.date == data["date"]
        ))
        if item:
            item.price, item.currency, item.source = data["price"], data["currency"], source_tag
        else:
            db.add(MarketPrice(**data, source=source_tag))
    db.commit()
    latest_date = max((item["date"] for item in fetched), default=None)
    return {"status":"updated" if fetched else "offline","updated":len(fetched),
            "as_of":latest_date,"errors":errors}


@router.get("/planned-items")
def planned_items(year: int = date.today().year, db: Session = Depends(get_db)):
    return db.scalars(select(PlannedItem).options(joinedload(PlannedItem.category)).where(PlannedItem.year == year).order_by(PlannedItem.kind, PlannedItem.name, PlannedItem.month)).all()


def validate_planned_item(payload: PlannedItemIn, db: Session) -> None:
    if payload.kind in {PlanKind.expense, PlanKind.income} and not payload.category_id:
        raise HTTPException(422, "Los gastos e ingresos del plan deben tener una categoría")
    if payload.category_id:
        category = db.get(Category, payload.category_id)
        if not category: raise HTTPException(404, "Category not found")
        if db.scalar(select(Category.id).where(Category.parent_id == category.id).limit(1)):
            raise HTTPException(422, "Las categorías padre no se pueden asignar")
        if payload.kind == PlanKind.income and not category.is_income:
            raise HTTPException(422, "Un ingreso necesita una categoría de ingreso")
        if payload.kind == PlanKind.expense and category.is_income:
            raise HTTPException(422, "Un gasto necesita una categoría de gasto")
    if payload.account_id and not db.get(Account, payload.account_id):
        raise HTTPException(404, "Account not found")


@router.post("/planned-items", status_code=201)
def upsert_planned_item(payload: PlannedItemIn, db: Session = Depends(get_db)):
    validate_planned_item(payload, db)
    item = db.scalar(select(PlannedItem).where(PlannedItem.year == payload.year, PlannedItem.month == payload.month,
        PlannedItem.kind == payload.kind, PlannedItem.name == payload.name, PlannedItem.owner == payload.owner))
    if item:
        for key,value in payload.model_dump().items(): setattr(item,key,value)
    else: item=PlannedItem(**payload.model_dump()); db.add(item)
    db.commit(); db.refresh(item); return item


@router.post("/planned-items/copy-month")
def copy_planned_month(payload: PlannedMonthCopyIn, db: Session = Depends(get_db)):
    target_months = sorted(set(payload.target_months))
    if not target_months:
        raise HTTPException(422, "Elegí al menos un mes de destino")
    if any(month < 1 or month > 12 for month in target_months):
        raise HTTPException(422, "Hay un mes de destino inválido")
    if payload.source_month in target_months:
        raise HTTPException(422, "El mes de origen no puede ser también destino")
    source = list(db.scalars(select(PlannedItem).where(
        PlannedItem.year == payload.year, PlannedItem.month == payload.source_month
    )).all())
    if not source:
        raise HTTPException(422, "El mes elegido no tiene montos proyectados para copiar")
    deleted = db.execute(delete(PlannedItem).where(
        PlannedItem.year == payload.year, PlannedItem.month.in_(target_months)
    )).rowcount or 0
    created = 0
    for month in target_months:
        for item in source:
            db.add(PlannedItem(
                year=payload.year, month=month, kind=item.kind, name=item.name,
                amount=item.amount, currency=item.currency,
                maximum_amount=item.maximum_amount,
                category_id=item.category_id, account_id=item.account_id,
                owner=item.owner, annual_paid=item.annual_paid, irregular=item.irregular,
            ))
            created += 1
    db.commit()
    return {"source_month": payload.source_month, "target_months": target_months,
            "source_items": len(source), "created": created, "replaced": deleted}


@router.patch("/planned-items/{item_id}")
def update_planned_item(item_id: str, payload: PlannedItemIn, db: Session = Depends(get_db)):
    item = db.get(PlannedItem, item_id)
    if not item: raise HTTPException(404, "Planned item not found")
    validate_planned_item(payload, db)
    for key, value in payload.model_dump().items(): setattr(item, key, value)
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, "Ya existe una línea igual en ese mes")
    db.refresh(item); return item


@router.delete("/planned-items/{item_id}", status_code=204)
def delete_planned_item(item_id: str, db: Session = Depends(get_db)):
    item=db.get(PlannedItem,item_id)
    if not item: raise HTTPException(404,"Planned item not found")
    db.delete(item); db.commit()


@router.get("/goals")
def goals(db: Session = Depends(get_db)):
    return db.scalars(select(SavingsGoal).where(SavingsGoal.active.is_(True)).order_by(SavingsGoal.name)).all()


@router.post("/goals", status_code=201)
def create_goal(payload: SavingsGoalIn, db: Session = Depends(get_db)):
    item=SavingsGoal(**payload.model_dump()); db.add(item); db.commit(); db.refresh(item); return item


@router.patch("/goals/{goal_id}")
def update_savings_goal(goal_id: str, payload: SavingsGoalIn, db: Session = Depends(get_db)):
    item=db.get(SavingsGoal,goal_id)
    if not item: raise HTTPException(404,"Goal not found")
    for key,value in payload.model_dump().items(): setattr(item,key,value)
    db.commit(); db.refresh(item); return item


@router.delete("/goals/{goal_id}", status_code=204)
def delete_savings_goal(goal_id: str, db: Session = Depends(get_db)):
    item=db.get(SavingsGoal,goal_id)
    if not item: raise HTTPException(404,"Goal not found")
    db.delete(item); db.commit()


@router.get("/exchange-rates")
def exchange_rates(db: Session = Depends(get_db)):
    return db.scalars(select(ExchangeRate).order_by(ExchangeRate.date.desc(),ExchangeRate.from_currency)).all()


@router.post("/exchange-rates", status_code=201)
def upsert_exchange_rate(payload: ExchangeRateIn, db: Session = Depends(get_db)):
    data=payload.model_dump(); data["from_currency"]=payload.from_currency.upper(); data["to_currency"]=payload.to_currency.upper()
    item=db.scalar(select(ExchangeRate).where(ExchangeRate.date==payload.date,ExchangeRate.from_currency==data["from_currency"],ExchangeRate.to_currency==data["to_currency"]))
    if item: item.rate,item.source=payload.rate,payload.source
    else: item=ExchangeRate(**data); db.add(item)
    db.commit(); db.refresh(item); return item


@router.post("/exchange-rates/refresh")
def refresh_exchange_rates(force: bool = False, db: Session = Depends(get_db)):
    today=date.today()
    existing=db.scalars(select(ExchangeRate).where(ExchangeRate.date==today,ExchangeRate.source=="frankfurter")).all()
    if not force and {item.from_currency for item in existing}>={"USD","UYU"}:
        return {"status":"cached","updated":0,"rates":existing,"errors":[]}
    rates,errors=fetch_cad_rates(); updated=[]
    for data in rates:
        item=db.scalar(select(ExchangeRate).where(ExchangeRate.date==data["date"],ExchangeRate.from_currency==data["from_currency"],ExchangeRate.to_currency=="CAD"))
        if item:
            item.rate,item.source=data["rate"],data["source"]
        else: item=ExchangeRate(**data); db.add(item)
        updated.append(item)
    db.commit()
    return {"status":"updated" if updated else "offline","updated":len(updated),"rates":updated,"errors":errors}


@router.get("/contribution-rooms")
def contribution_rooms(year: int = date.today().year, db: Session = Depends(get_db)):
    return db.scalars(select(ContributionRoom).where(ContributionRoom.year==year).order_by(ContributionRoom.owner,ContributionRoom.account_type)).all()


@router.post("/contribution-rooms", status_code=201)
def upsert_contribution_room(payload: ContributionRoomIn, db: Session = Depends(get_db)):
    if payload.account_type == "RESP" and not payload.beneficiary: raise HTTPException(422,"RESP requires a beneficiary")
    beneficiary = payload.beneficiary if payload.account_type == "RESP" else ""
    item=db.scalar(select(ContributionRoom).where(ContributionRoom.year==payload.year,ContributionRoom.owner==payload.owner,ContributionRoom.account_type==payload.account_type,ContributionRoom.beneficiary==beneficiary))
    if item:
        item.limit_amount,item.contributed_amount,item.currency=payload.limit_amount,payload.contributed_amount,payload.currency
    else:
        data=payload.model_dump(); data["beneficiary"]=beneficiary
        item=ContributionRoom(**data); db.add(item)
    db.commit(); db.refresh(item); return item


@router.patch("/contribution-rooms/{room_id}")
def update_contribution_room(room_id: str, payload: ContributionRoomIn, db: Session = Depends(get_db)):
    item=db.get(ContributionRoom,room_id)
    if not item: raise HTTPException(404,"Contribution room not found")
    if payload.account_type == "RESP" and not payload.beneficiary: raise HTTPException(422,"RESP requires a beneficiary")
    data=payload.model_dump(); data["beneficiary"]=payload.beneficiary if payload.account_type == "RESP" else ""
    for key,value in data.items(): setattr(item,key,value)
    try: db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409,"Ya existe un límite para esa persona, cuenta y año")
    db.refresh(item); return item


@router.delete("/contribution-rooms/{room_id}", status_code=204)
def delete_contribution_room(room_id: str, db: Session = Depends(get_db)):
    item=db.get(ContributionRoom,room_id)
    if not item: raise HTTPException(404,"Contribution room not found")
    db.delete(item); db.commit()


@router.get("/information")
def information_notes(db: Session = Depends(get_db)):
    return db.scalars(select(InformationNote).order_by(InformationNote.category, InformationNote.title)).all()


@router.post("/information", status_code=201)
def create_information_note(payload: InformationNoteIn, db: Session = Depends(get_db)):
    item=InformationNote(**payload.model_dump()); db.add(item); db.commit(); db.refresh(item); return item


@router.patch("/information/{note_id}")
def update_information_note(note_id: str, payload: InformationNoteIn, db: Session = Depends(get_db)):
    item=db.get(InformationNote,note_id)
    if not item: raise HTTPException(404,"Information note not found")
    for key,value in payload.model_dump().items(): setattr(item,key,value)
    item.updated_at=datetime.utcnow(); db.commit(); db.refresh(item); return item


@router.delete("/information/{note_id}", status_code=204)
def delete_information_note(note_id: str, db: Session = Depends(get_db)):
    item=db.get(InformationNote,note_id)
    if not item: raise HTTPException(404,"Information note not found")
    db.delete(item); db.commit()


def retirement_snapshot(db: Session, profile: RetirementProfile) -> dict:
    today_value = date.today()
    year = today_value.year
    investment_accounts = db.scalars(
        select(Account).where(Account.archived.is_(False), Account.type == "investment")
    ).all()
    investment_accounts = [
        account for account in investment_accounts
        if (account.account_subtype or "").upper() != "RESP" and "RESP" not in account.name.upper()
    ]
    portfolio = Decimal("0")
    missing_rates: set[str] = set()
    for account in account_values(db, investment_accounts):
        rate = latest_rate(db, account.currency, today_value)
        if rate is None:
            missing_rates.add(account.currency)
        else:
            portfolio += Decimal(account.balance or 0) * rate

    plan_items = db.scalars(select(PlannedItem).where(PlannedItem.year == year)).all()
    plan_accounts = {account.id: account for account in db.scalars(select(Account)).all()}
    planned = {kind: Decimal("0") for kind in PlanKind}
    for item in plan_items:
        linked_account = plan_accounts.get(item.account_id) if item.account_id else None
        is_resp = (
            item.kind == PlanKind.investment and (
                "RESP" in item.name.upper() or
                (linked_account is not None and (
                    (linked_account.account_subtype or "").upper() == "RESP" or
                    "RESP" in linked_account.name.upper()
                ))
            )
        )
        if is_resp: continue
        rate = latest_rate(db, item.currency)
        if rate is not None:
            planned[item.kind] += item.amount * rate
    derived_spending = planned[PlanKind.expense]
    derived_contribution = planned[PlanKind.saving] + planned[PlanKind.investment]
    spending = Decimal(profile.annual_spending) if profile.annual_spending is not None else derived_spending
    contribution = Decimal(profile.annual_contribution) if profile.annual_contribution is not None else derived_contribution
    passive = Decimal(profile.passive_income)
    withdrawal_rate = Decimal(profile.withdrawal_rate)
    real_return = Decimal(profile.real_return)
    try:
        people = json.loads(profile.people_config or "{}")
    except (TypeError, json.JSONDecodeError):
        people = {}

    defaults = {
        "person_b": {"name": "Person B"},
        "person_a": {"name": "Person A"},
    }
    births = {"person_b": profile.person_b_birth_date, "person_a": profile.person_a_birth_date}
    pension_sources = []
    people_out = {}

    def number(value, fallback="0") -> Decimal:
        if value in (None, ""): return Decimal(fallback)
        try: return Decimal(str(value))
        except Exception: return Decimal(fallback)

    def cpp_monthly(config: dict) -> Decimal:
        age = int(config.get("cpp_start_age") or 65)
        estimates = {60: number(config.get("cpp_monthly_60")), 65: number(config.get("cpp_monthly_65")), 70: number(config.get("cpp_monthly_70"))}
        if estimates.get(age, Decimal("0")) > 0: return estimates[age]
        if age < 65 and estimates[60] > 0 and estimates[65] > 0:
            return estimates[60] + (estimates[65] - estimates[60]) * Decimal(age - 60) / Decimal("5")
        if age > 65 and estimates[65] > 0 and estimates[70] > 0:
            return estimates[65] + (estimates[70] - estimates[65]) * Decimal(age - 65) / Decimal("5")
        base = estimates[65]
        if base <= 0: return Decimal("0")
        factor = Decimal("1") - Decimal("0.072") * Decimal(65 - age) if age < 65 else Decimal("1") + Decimal("0.084") * Decimal(age - 65)
        return base * factor

    for key in ("person_b", "person_a"):
        config = {**defaults[key], **(people.get(key) or {})}
        birth = births[key]
        sources = []
        cpp = cpp_monthly(config)
        cpp_age = int(config.get("cpp_start_age") or 65)
        if birth and cpp > 0:
            sources.append({"kind":"CPP", "label":"CPP", "start_age":cpp_age, "start_year":birth.year + cpp_age, "monthly":cpp, "annual":cpp * 12, "status":config.get("cpp_status") or "estimado"})

        oas_age = int(config.get("oas_start_age") or 65)
        residence_date = config.get("canada_residence_start_date")
        residence_years = None
        oas_ratio = Decimal("0")
        if birth and residence_date:
            try:
                start_residence = date.fromisoformat(residence_date)
                count_from_year = max(start_residence.year, birth.year + 18)
                residence_years = max(0, birth.year + oas_age - count_from_year - int(config.get("years_outside_canada") or 0))
                oas_ratio = min(Decimal("1"), Decimal(residence_years) / Decimal("40"))
            except ValueError:
                pass
        oas_max = number(config.get("oas_max_monthly"), "751.97")
        if oas_age > 65:
            oas_max *= Decimal("1") + Decimal("0.072") * Decimal(oas_age - 65)
        oas_monthly = oas_max * oas_ratio
        if birth and oas_monthly > 0:
            start_year = birth.year + oas_age
            sources.append({"kind":"OAS", "label":"OAS", "start_age":oas_age, "start_year":start_year, "monthly":oas_monthly, "annual":oas_monthly * 12, "status":"calculado", "residence_years":residence_years, "oas_ratio":oas_ratio})
            # OAS increases by 10% at age 75. Represent the increment as a second event.
            if oas_age < 75:
                sources.append({"kind":"OAS75", "label":"Aumento OAS a los 75", "start_age":75, "start_year":birth.year + 75, "monthly":oas_monthly * Decimal("0.10"), "annual":oas_monthly * Decimal("0.10") * 12, "status":"calculado"})

        for kind, prefix, label in (("BPS", "bps", "BPS Uruguay"), ("EMPLOYER", "employer", "Pensión laboral")):
            original_monthly = number(config.get(f"{prefix}_monthly"))
            source_currency = str(config.get(f"{prefix}_currency") or "CAD").upper()
            conversion = latest_rate(db, source_currency, today_value)
            monthly = original_monthly * conversion if conversion is not None else Decimal("0")
            if original_monthly > 0 and conversion is None:
                missing_rates.add(source_currency)
            start_age = int(config.get(f"{prefix}_start_age") or 65)
            if birth and monthly > 0:
                sources.append({"kind":kind, "label":label, "start_age":start_age, "start_year":birth.year + start_age, "monthly":monthly, "annual":monthly * 12, "status":config.get(f"{prefix}_status") or "estimado", "original_monthly":original_monthly, "original_currency":source_currency})

        pension_sources.extend([{**source, "person":key, "person_name":config["name"]} for source in sources])
        people_out[key] = {**config, "birth_date":birth, "sources":sources, "oas_residence_years":residence_years, "oas_ratio":oas_ratio}

    # Backward compatibility: preserve the old household amount until it is
    # replaced by detailed sources, but show it explicitly as a legacy estimate.
    legacy_public = Decimal(profile.public_income)
    if not pension_sources and legacy_public > 0:
        start_years = [birth.year + profile.public_income_start_age for birth in births.values() if birth]
        if start_years:
            pension_sources.append({"kind":"LEGACY", "label":"Estimación familiar anterior", "person":"household", "person_name":"Familia", "start_age":profile.public_income_start_age, "start_year":max(start_years), "monthly":legacy_public / 12, "annual":legacy_public, "status":"revisar"})

    pension_sources.sort(key=lambda source: (source["start_year"], source["person_name"], source["kind"]))
    public = sum((Decimal(source["annual"]) for source in pension_sources), Decimal("0"))
    public_net = public * (Decimal("1") - Decimal(profile.estimated_tax_rate))
    required_from_portfolio = max(Decimal("0"), spending - passive)
    required_after_public = max(Decimal("0"), spending - passive - public_net)
    fi_number = required_from_portfolio / withdrawal_rate if withdrawal_rate else Decimal("0")
    later_fi_number = required_after_public / withdrawal_rate if withdrawal_rate else Decimal("0")

    public_start_year = min((source["start_year"] for source in pension_sources), default=None)

    def income_in_year(future_year: int) -> Decimal:
        gross = sum((Decimal(source["annual"]) for source in pension_sources if source["start_year"] <= future_year), Decimal("0"))
        return gross * (Decimal("1") - Decimal(profile.estimated_tax_rate))

    def capital_needed(retirement_year: int, rate: Decimal = real_return) -> Decimal:
        if not pension_sources: return fi_number
        final_year = max(source["start_year"] for source in pension_sources)
        final_need = max(Decimal("0"), spending - passive - income_in_year(final_year))
        capital = final_need / withdrawal_rate if withdrawal_rate else Decimal("0")
        growth = Decimal("1") + rate
        for bridge_year in range(final_year - 1, retirement_year - 1, -1):
            annual_need = max(Decimal("0"), spending - passive - income_in_year(bridge_year))
            capital = annual_need + capital / growth
        return capital

    def project(rate: Decimal, milestone: Decimal | None = None) -> tuple[int | None, Decimal, Decimal]:
        value = portfolio
        target = fi_number * milestone if milestone is not None else capital_needed(year, rate)
        if value >= target: return 0, value, target
        for years in range(1, 61):
            value = value * (Decimal("1") + rate) + contribution
            target = fi_number * milestone if milestone is not None else capital_needed(year + years, rate)
            if value >= target: return years, value, target
        return None, value, target

    def value_after(years: int, rate: Decimal = real_return) -> Decimal:
        value = portfolio
        for _ in range(max(0, years)):
            value = value * (Decimal("1") + rate) + contribution
        return value

    def age_on(birth: date | None, future_year: int | None) -> int | None:
        if not birth or future_year is None: return None
        future_date = date(future_year, today_value.month, min(today_value.day, monthrange(future_year, today_value.month)[1]))
        return future_date.year - birth.year - ((future_date.month, future_date.day) < (birth.month, birth.day))

    base_years, base_value, base_target_capital = project(real_return)
    target_years = [
        birth.year + profile.target_retirement_age
        for birth in (profile.person_b_birth_date, profile.person_a_birth_date) if birth is not None
    ]
    target_year = max(target_years) if len(target_years) == 2 else None
    years_to_target = max(0, target_year - year) if target_year is not None else None
    portfolio_at_target = value_after(years_to_target) if years_to_target is not None else None
    target_capital_at_target = capital_needed(target_year) if target_year is not None else None
    scenarios = []
    for label, rate in (("Conservador", Decimal("0.02")), ("Base", real_return), ("Favorable", Decimal("0.06"))):
        years, value, target_capital = project(rate)
        retirement_year = year + years if years is not None else None
        scenarios.append({
            "label": label, "real_return": rate, "years": years, "year": retirement_year,
            "portfolio": value, "target_capital": target_capital,
            "person_b_age": age_on(profile.person_b_birth_date, retirement_year),
            "person_a_age": age_on(profile.person_a_birth_date, retirement_year),
        })
    milestones = []
    for percentage in (25, 50, 75, 100):
        years, _, _ = project(real_return, Decimal(percentage) / Decimal("100"))
        milestones.append({"percentage": percentage, "years": years, "year": year + years if years is not None else None})
    progress = min(Decimal("100"), portfolio / fi_number * Decimal("100")) if fi_number > 0 else Decimal("0")
    annual_income_at_fi = portfolio * withdrawal_rate + passive
    recommendations = []
    if profile.person_b_birth_date is None or profile.person_a_birth_date is None:
        recommendations.append("Cargá las fechas de nacimiento para convertir el horizonte en edades de retiro para ambos.")
    if profile.annual_spending is None:
        recommendations.append("El gasto objetivo usa el plan anual actual. Editalo si el estilo de vida de retiro será distinto.")
    if profile.annual_contribution is None:
        recommendations.append("El aporte anual usa Ahorro + Inversiones del plan. Confirmá que sea sostenible y no incluya RESP.")
    missing_data = []
    for key, person in people_out.items():
        if not births[key]: missing_data.append(f"Fecha de nacimiento de {person['name']}")
        if not number(person.get("cpp_monthly_65")): missing_data.append(f"Estimado CPP de {person['name']}")
        if not person.get("canada_residence_start_date"): missing_data.append(f"Inicio de residencia en Canadá de {person['name']}")
    if missing_data:
        recommendations.append("Completá los datos pendientes de pensiones públicas para que la proyección deje de ser conservadora.")
    elif public_start_year is not None:
        recommendations.append(f"Los ingresos garantizados comienzan por etapas desde {public_start_year}; revisá los montos al menos una vez por año.")
    if base_years is not None and base_years > 15:
        recommendations.append("El mayor acelerador controlable es aumentar el aporte anual o reducir el gasto objetivo; compará ambos en Supuestos.")
    recommendations.append("Antes de dejar de trabajar, reservá 18–24 meses de gastos en efectivo o instrumentos de muy corto plazo.")
    return {
        "profile": profile, "people": people_out, "pension_sources": pension_sources,
        "missing_retirement_data": missing_data,
        "currency": "CAD", "portfolio": portfolio,
        "derived_spending": derived_spending, "derived_contribution": derived_contribution,
        "effective_spending": spending, "effective_contribution": contribution,
        "fi_number": fi_number, "fi_number_after_public": later_fi_number,
        "required_from_portfolio": required_from_portfolio,
        "required_after_public": required_after_public,
        "public_start_year": public_start_year,
        "progress": progress, "passive_income": passive, "public_income": public,
        "current_sustainable_income": annual_income_at_fi, "estimated_public_income_net": public_net, "base_years": base_years,
        "base_year": year + base_years if base_years is not None else None,
        "base_projected_portfolio": base_value, "base_target_capital": base_target_capital,
        "scenarios": scenarios,
        "target_year": target_year, "years_to_target": years_to_target,
        "portfolio_at_target": portfolio_at_target,
        "target_capital_at_target": target_capital_at_target,
        "target_gap": max(Decimal("0"), target_capital_at_target - portfolio_at_target) if portfolio_at_target is not None and target_capital_at_target is not None else None,
        "milestones": milestones, "recommendations": recommendations,
        "missing_rates": sorted(missing_rates),
    }


@router.get("/retirement")
def retirement(db: Session = Depends(get_db)):
    profile = db.scalar(select(RetirementProfile).limit(1))
    if profile is None:
        profile = RetirementProfile(); db.add(profile); db.commit(); db.refresh(profile)
    return retirement_snapshot(db, profile)


@router.patch("/retirement")
def update_retirement(payload: RetirementProfileIn, db: Session = Depends(get_db)):
    profile = db.scalar(select(RetirementProfile).limit(1))
    if profile is None:
        profile = RetirementProfile(); db.add(profile)
    values = payload.model_dump()
    people = values.pop("people", {})
    for key, value in values.items(): setattr(profile, key, value)
    profile.people_config = json.dumps(people)
    profile.updated_at = datetime.utcnow(); db.commit(); db.refresh(profile)
    return retirement_snapshot(db, profile)


@router.get("/annual-plan")
def annual_plan(year: int = date.today().year, db: Session = Depends(get_db)):
    planned=db.scalars(select(PlannedItem).where(PlannedItem.year==year)).all()
    months=[]
    for month in range(1,13):
        native={currency:{kind.value:Decimal("0") for kind in PlanKind} for currency in ("CAD","USD","UYU")}
        for item in planned:
            if item.month==month: native.setdefault(item.currency,{kind.value:Decimal("0") for kind in PlanKind})[item.kind.value]+=item.amount
        converted={kind.value:Decimal("0") for kind in PlanKind}; missing=[]
        for currency,values in native.items():
            # This is a forward-looking budget, so every month uses the same
            # latest available rate. Historical cutoffs made identical monthly
            # plans appear different when an older FX observation was missing.
            rate=latest_rate(db,currency)
            if rate is None and any(values.values()): missing.append(currency); continue
            if rate is not None:
                for kind,value in values.items(): converted[kind]+=value*rate
        free=converted["income"]-converted["expense"]-converted["investment"]-converted["saving"]
        months.append({"month":month,"native":native,"cad":converted,"free":free,"missing_rates":missing})
    return {"year":year,"months":months,"annual":{"income":sum(m["cad"]["income"] for m in months),"expense":sum(m["cad"]["expense"] for m in months),"investment":sum(m["cad"]["investment"] for m in months),"saving":sum(m["cad"]["saving"] for m in months),"free":sum(m["free"] for m in months)}}


def scoped_budget_variance(planned: list[PlannedItem], start: date, end: date, db: Session) -> tuple[list[dict], dict]:
    categories={item.id:item for item in db.scalars(select(Category)).all()}
    accounts_by_id={item.id:item for item in db.scalars(select(Account)).all()}
    rows: dict[str,dict] = {}
    for item in planned:
        category=categories.get(item.category_id); account=accounts_by_id.get(item.account_id)
        rows[item.id]={"planned_item_id":item.id,"category_id":item.category_id,"category":item.name,
            "matched_category":category.name if category else None,
            "parent":categories.get(category.parent_id).name if category and category.parent_id in categories else None,
            "essential":category.is_essential if category else None,"currency":item.currency,
            "owner":item.owner.value if hasattr(item.owner,"value") else str(item.owner),
            "account_id":item.account_id,"account_name":account.name if account else None,
            "projected":Decimal(item.amount),"maximum":Decimal(item.maximum_amount) if item.maximum_amount is not None else None,
            "irregular":bool(item.irregular),"monthly_reserve":Decimal(item.amount)/12 if item.irregular else Decimal("0"),
            "actual":Decimal("0"),"_scope":item}
    transactions=[] if end<=start else list(db.scalars(select(Transaction).options(joinedload(Transaction.account)).where(
        Transaction.date>=start,Transaction.date<end,Transaction.kind==TransactionKind.expense,
        Transaction.category_id.is_not(None))).all())
    for transaction in transactions:
        candidates=[]
        for row in rows.values():
            item=row["_scope"]
            if item is None: continue
            if item.category_id!=transaction.category_id or item.currency!=transaction.currency: continue
            owner=item.owner.value if hasattr(item.owner,"value") else str(item.owner)
            if item.account_id:
                if item.account_id!=transaction.account_id: continue
                specificity=2
            elif owner!="household":
                account_owner=transaction.account.owner.value if hasattr(transaction.account.owner,"value") else str(transaction.account.owner)
                if owner!=account_owner: continue
                specificity=1
            else: specificity=0
            candidates.append((specificity,row))
        if candidates:
            candidates.sort(key=lambda candidate:(-candidate[0],candidate[1]["category"],candidate[1]["planned_item_id"]))
            candidates[0][1]["actual"]-=transaction.amount
        else:
            category=categories.get(transaction.category_id); key=f"actual-{transaction.category_id}-{transaction.currency}"
            row=rows.setdefault(key,{"planned_item_id":None,"category_id":transaction.category_id,
                "category":category.name if category else "Sin categoría","matched_category":category.name if category else None,
                "parent":categories.get(category.parent_id).name if category and category.parent_id in categories else None,
                "essential":category.is_essential if category else None,"currency":transaction.currency,
                "owner":"household","account_id":None,"account_name":None,
                "projected":Decimal("0"),"maximum":None,"irregular":False,"monthly_reserve":Decimal("0"),
                "actual":Decimal("0"),"_scope":None})
            row["actual"]-=transaction.amount
    result=[]
    for row in rows.values():
        row.pop("_scope",None); row["variance"]=row["actual"]-row["projected"]
        row["percentage_used"]=(row["actual"]/row["projected"]*100) if row["projected"] else None
        row["status"]="over_max" if row["maximum"] is not None and row["actual"]>row["maximum"] else "over" if row["variance"]>0 else "under" if row["variance"]<0 else "on_target"
        result.append(row)
    result.sort(key=lambda row:((row["parent"] or ""),row["category"],row["owner"]))
    totals={currency:{"projected":Decimal("0"),"actual":Decimal("0"),"variance":Decimal("0")} for currency in ("CAD","USD","UYU")}
    for row in result:
        total=totals.setdefault(row["currency"],{"projected":Decimal("0"),"actual":Decimal("0"),"variance":Decimal("0")})
        for field in ("projected","actual","variance"): total[field]+=row[field]
    return result,totals


@router.get("/budget-variance")
def budget_variance(year: int = date.today().year, month: int = date.today().month, db: Session = Depends(get_db)):
    if month < 1 or month > 12: raise HTTPException(422,"month must be between 1 and 12")
    start=date(year,month,1); end=date(year+(month==12),1 if month==12 else month+1,1)
    planned=list(db.scalars(select(PlannedItem).where(PlannedItem.year==year,PlannedItem.month==month,PlannedItem.kind==PlanKind.expense)).all())
    result, totals = scoped_budget_variance(planned, start, end, db)
    return {"year":year,"month":month,"rows":result,"totals":totals}


@router.get("/budget-variance-annual")
def annual_budget_variance(year: int = date.today().year, db: Session = Depends(get_db)):
    start = date(year, 1, 1)
    year_end = date(year + 1, 1, 1)
    today = datetime.now(ZoneInfo("America/Toronto")).date()
    actual_end = start if year > today.year else year_end if year < today.year else min(year_end, today + timedelta(days=1))
    planned = list(db.scalars(select(PlannedItem).where(PlannedItem.year == year, PlannedItem.kind == PlanKind.expense)).all())
    grouped: dict[tuple, PlannedItem] = {}
    for item in planned:
        key=(item.category_id,item.name,item.currency,item.owner,item.account_id)
        if key in grouped:
            grouped[key].amount += item.amount
            if item.maximum_amount is not None:
                grouped[key].maximum_amount = (grouped[key].maximum_amount or Decimal("0")) + item.maximum_amount
        else:
            grouped[key]=PlannedItem(id=item.id,year=item.year,month=1,kind=item.kind,name=item.name,amount=item.amount,
                maximum_amount=item.maximum_amount,currency=item.currency,category_id=item.category_id,account_id=item.account_id,
                owner=item.owner,annual_paid=item.annual_paid,irregular=item.irregular)
    result, totals = scoped_budget_variance(list(grouped.values()), start, actual_end, db)
    result.sort(key=lambda row: (-row["projected"], row["category"]))
    for total in totals.values(): total["percentage_used"] = total["actual"] / total["projected"] * 100 if total["projected"] else None
    return {"year":year,"as_of":min(today, date(year,12,31)) if year <= today.year else None,"rows":result,"totals":totals}



def household_settings_row(db: Session) -> HouseholdSettings:
    settings_row = db.scalar(select(HouseholdSettings).limit(1))
    if not settings_row:
        settings_row = HouseholdSettings()
        db.add(settings_row); db.commit(); db.refresh(settings_row)
    return settings_row


@router.get("/household-settings")
def household_settings(db: Session = Depends(get_db)):
    return household_settings_row(db)


@router.patch("/household-settings")
def update_household_settings(payload: HouseholdSettingsIn, db: Session = Depends(get_db)):
    item = household_settings_row(db)
    item.joint_person_a_share = payload.joint_person_a_share
    item.emergency_fund_target_cad = payload.emergency_fund_target_cad
    item.benchmark_symbol = payload.benchmark_symbol.upper().strip()
    item.updated_at = datetime.utcnow(); db.commit(); db.refresh(item)
    return item


@router.get("/investment-targets")
def investment_targets(portfolio_key: str = "household", db: Session = Depends(get_db)):
    return db.scalars(select(InvestmentTarget).where(InvestmentTarget.portfolio_key == portfolio_key).order_by(InvestmentTarget.asset_class)).all()


@router.put("/investment-targets")
def update_investment_targets(payload: InvestmentTargetsIn, db: Session = Depends(get_db)):
    allowed={"equity","fixed_income","cash"}
    if set(payload.targets) - allowed: raise HTTPException(422,"Asset class inválida")
    total=sum((Decimal(value) for value in payload.targets.values()),Decimal("0"))
    if abs(total-Decimal("100")) > Decimal("0.01"): raise HTTPException(422,"Los objetivos deben sumar 100%")
    db.execute(delete(InvestmentTarget).where(InvestmentTarget.portfolio_key == payload.portfolio_key))
    for asset_class,value in payload.targets.items():
        if Decimal(value)<0: raise HTTPException(422,"Los porcentajes no pueden ser negativos")
        db.add(InvestmentTarget(portfolio_key=payload.portfolio_key,asset_class=asset_class,target_percentage=Decimal(value)))
    db.commit()
    return investment_targets(payload.portfolio_key,db)


def owner_weight(account: Account, scope: str, joint_person_a_share: Decimal) -> Decimal:
    owner = account.owner.value if hasattr(account.owner, "value") else str(account.owner)
    if scope == "household": return Decimal("1")
    if scope == "joint": return Decimal("1") if owner in {"joint", "household"} else Decimal("0")
    if scope == "children": return Decimal("1") if account.account_subtype == "RESP" else Decimal("0")
    if account.account_subtype == "RESP" and scope in {"person_a", "person_b"}: return Decimal("0")
    if owner == scope: return Decimal("1")
    if owner in {"joint", "household"}:
        return joint_person_a_share if scope == "person_a" else Decimal("1") - joint_person_a_share if scope == "person_b" else Decimal("0")
    return Decimal("0")


def calculate_xirr(cashflows: list[tuple[date, Decimal]]) -> Decimal | None:
    """Money-weighted annual return; returns None when cash flows cannot define a rate."""
    if len(cashflows) < 2 or not any(value < 0 for _, value in cashflows) or not any(value > 0 for _, value in cashflows): return None
    origin=min(day for day,_ in cashflows)
    def npv(rate: Decimal) -> Decimal:
        return sum((value / Decimal((1 + float(rate)) ** ((day-origin).days/365.0)) for day,value in cashflows),Decimal("0"))
    low,high=Decimal("-0.9999"),Decimal("100")
    low_value,high_value=npv(low),npv(high)
    if low_value*high_value>0: return None
    for _ in range(120):
        middle=(low+high)/2; value=npv(middle)
        if abs(value)<Decimal("0.01"): return middle*100
        if low_value*value<=0: high=middle
        else: low,low_value=middle,value
    return (low+high)/2*100


@router.get("/insights")
def financial_insights(scope: str = "household", days: int = 90, db: Session = Depends(get_db)):
    if scope not in {"household", "person_a", "person_b", "joint", "children"}: raise HTTPException(422, "Invalid scope")
    days = max(30, min(days, 365)); today_value = datetime.now(ZoneInfo("America/Toronto")).date()
    settings_row = household_settings_row(db); joint_share = Decimal(settings_row.joint_person_a_share)
    raw_accounts = list(db.scalars(select(Account).where(Account.archived.is_(False))).all())
    valued = {item.id: item for item in account_values(db, raw_accounts)}
    accounts_by_id = {item.id:item for item in raw_accounts}
    ownership = {key:{"cash":Decimal("0"),"investments":Decimal("0"),"debts":Decimal("0"),"net_worth":Decimal("0")}
                 for key in ("person_a","person_b","joint","children")}
    selected = {"cash":Decimal("0"),"investments":Decimal("0"),"debts":Decimal("0"),"net_worth":Decimal("0")}
    for account in raw_accounts:
        value = Decimal(valued[account.id].balance or 0); rate = latest_rate(db, account.currency, today_value)
        if rate is None: continue
        cad = value * rate
        bucket = "debts" if account.type.value == "credit_card" or cad < 0 else "investments" if account.type.value == "investment" else "cash"
        for key in ownership:
            weight = owner_weight(account, key, joint_share)
            if weight:
                amount = abs(cad) * weight if bucket == "debts" else cad * weight
                ownership[key][bucket] += amount
                ownership[key]["net_worth"] += -amount if bucket == "debts" else amount
        weight = owner_weight(account, scope, joint_share)
        if weight:
            amount = abs(cad) * weight if bucket == "debts" else cad * weight
            selected[bucket] += amount; selected["net_worth"] += -amount if bucket == "debts" else amount

    # A daily snapshot makes the history useful without asking the user to maintain it.
    snapshot = db.scalar(select(NetWorthSnapshot).where(NetWorthSnapshot.date == today_value))
    household = {key: ownership["person_a"][key] + ownership["person_b"][key] for key in selected}
    payload_breakdown = json.dumps({key:{field:str(value) for field,value in data.items()} for key,data in ownership.items()})
    if snapshot:
        snapshot.total_cad, snapshot.cash_cad, snapshot.investments_cad, snapshot.debts_cad = household["net_worth"], household["cash"], household["investments"], household["debts"]
        snapshot.breakdown = payload_breakdown
    else:
        db.add(NetWorthSnapshot(date=today_value,total_cad=household["net_worth"],cash_cad=household["cash"],
                                investments_cad=household["investments"],debts_cad=household["debts"],breakdown=payload_breakdown))

    materialize_occurrences(db, today_value + timedelta(days=days))
    liquid = sum((Decimal(valued[a.id].balance or 0) * (latest_rate(db,a.currency,today_value) or 0)
                  * owner_weight(a,scope,joint_share)
                  for a in raw_accounts if a.type.value in {"checking","savings","cash"} and owner_weight(a,scope,joint_share)), Decimal("0"))
    occurrences = list(db.scalars(select(RecurringOccurrence).options(joinedload(RecurringOccurrence.recurring)).where(
        RecurringOccurrence.status == "pending", RecurringOccurrence.scheduled_date >= today_value,
        RecurringOccurrence.scheduled_date <= today_value + timedelta(days=days))).all())
    flow_by_date: dict[date,Decimal] = {}
    for occurrence in occurrences:
        account = accounts_by_id.get(occurrence.recurring.account_id)
        if not account: continue
        weight = owner_weight(account,scope,joint_share)
        rate = latest_rate(db,occurrence.recurring.currency,occurrence.scheduled_date)
        if not weight or rate is None: continue
        flow_by_date[occurrence.scheduled_date] = flow_by_date.get(occurrence.scheduled_date,Decimal("0")) + occurrence.recurring.amount*rate*weight
    running=liquid; forecast=[]
    for offset in range(days+1):
        current=today_value+timedelta(days=offset); change=flow_by_date.get(current,Decimal("0")); running+=change
        forecast.append({"date":current,"change":change,"balance":running})

    first_income_date=next((row["date"] for row in forecast if row["change"]>0),today_value+timedelta(days=min(days,30)))
    committed_outflows=sum((-row["change"] for row in forecast if row["date"]<=first_income_date and row["change"]<0),Decimal("0"))
    irregular_reserve=Decimal("0")
    for item in db.scalars(select(PlannedItem).where(PlannedItem.year==today_value.year,PlannedItem.kind==PlanKind.expense,PlannedItem.irregular.is_(True))).all():
        rate=latest_rate(db,item.currency,today_value)
        if rate is not None: irregular_reserve += item.amount*rate/12
    emergency_target=Decimal(settings_row.emergency_fund_target_cad or 0)
    if scope in {"person_a","person_b"}: emergency_target*=Decimal("0.5")
    available_to_spend=max(Decimal("0"),liquid-committed_outflows-irregular_reserve-emergency_target)

    allocation: dict[str,Decimal]={}; performance_accounts=[]; total_value=total_cost=Decimal("0")
    fixed_income_symbols={"BND","XSB.TO","CBIL.TO","ZAG.TO","VAB.TO"}
    for holding in db.scalars(select(Holding).options(joinedload(Holding.instrument),joinedload(Holding.account)).join(Account).where(Account.archived.is_(False))).all():
        weight=owner_weight(holding.account,scope,joint_share); price=latest_market_price(db,holding.instrument_id)
        rate=latest_rate(db,holding.instrument.currency,today_value)
        if not weight or not price or rate is None: continue
        value=holding.quantity*price.price*rate*weight; cost=holding.quantity*holding.average_cost*rate*weight
        asset_class="fixed_income" if holding.instrument.symbol.upper() in fixed_income_symbols else holding.instrument.asset_class
        allocation[asset_class]=allocation.get(asset_class,Decimal("0"))+value
        total_value+=value; total_cost+=cost
        performance_accounts.append({"account":holding.account.name,"symbol":holding.instrument.symbol,
            "asset_class":asset_class,"value_cad":value,"cost_cad":cost,"gain_cad":value-cost,
            "return_pct":(value/cost-1)*100 if cost else None})

    # Cash inside an investment account is part of allocation, but not an investment return.
    for account in raw_accounts:
        if account.type.value != "investment": continue
        weight=owner_weight(account,scope,joint_share); rate=latest_rate(db,account.currency,today_value)
        if weight and rate:
            cash_value=Decimal(valued[account.id].cash_balance or 0)*rate*weight
            if cash_value: allocation["cash"]=allocation.get("cash",Decimal("0"))+cash_value
    allocation_total=sum(allocation.values(),Decimal("0"))

    target_rows=list(db.scalars(select(InvestmentTarget).where(InvestmentTarget.portfolio_key==scope)).all())
    targets={row.asset_class:Decimal(row.target_percentage) for row in target_rows}
    rebalance=[]
    if targets and allocation_total:
        target_cash=allocation_total*targets.get("cash",Decimal("0"))/100
        deployable=max(Decimal("0"),allocation.get("cash",Decimal("0"))-target_cash)
        deficits={key:max(Decimal("0"),allocation_total*pct/100-allocation.get(key,Decimal("0"))) for key,pct in targets.items() if key!="cash"}
        deficit_total=sum(deficits.values(),Decimal("0"))
        for key,pct in targets.items():
            current=allocation.get(key,Decimal("0")); desired=allocation_total*pct/100
            buy=deployable*deficits.get(key,Decimal("0"))/deficit_total if deficit_total else Decimal("0")
            rebalance.append({"asset_class":key,"current":current,"current_pct":current/allocation_total*100,
                              "target_pct":pct,"difference":current-desired,"buy_with_cash":buy})

    investment_account_ids=[account.id for account in raw_accounts if account.type.value=="investment" and owner_weight(account,scope,joint_share)]
    investment_income=Decimal("0")
    if investment_account_ids:
        income_rows=db.scalars(select(Transaction).where(Transaction.account_id.in_(investment_account_ids),Transaction.kind==TransactionKind.income)).all()
        for transaction in income_rows:
            if any(word in transaction.description.casefold() for word in ("dividend","distribution","interest","dividendo","interés")):
                rate=latest_rate(db,transaction.currency,transaction.date)
                account=accounts_by_id.get(transaction.account_id)
                if rate is not None and account: investment_income+=transaction.amount*rate*owner_weight(account,scope,joint_share)
    benchmark={"symbol":settings_row.benchmark_symbol,"return_pct":None,"from_date":None,"to_date":None}
    benchmark_instrument=db.scalar(select(Instrument).where(func.upper(Instrument.symbol)==settings_row.benchmark_symbol.upper()))
    if benchmark_instrument:
        benchmark_prices=list(db.scalars(select(MarketPrice).where(MarketPrice.instrument_id==benchmark_instrument.id).order_by(MarketPrice.date)).all())
        if len(benchmark_prices)>=2 and benchmark_prices[0].price:
            benchmark.update({"return_pct":(benchmark_prices[-1].price/benchmark_prices[0].price-1)*100,
                              "from_date":benchmark_prices[0].date,"to_date":benchmark_prices[-1].date})
    cashflows=[]
    if investment_account_ids:
        for transaction in db.scalars(select(Transaction).where(Transaction.account_id.in_(investment_account_ids),Transaction.kind==TransactionKind.transfer).order_by(Transaction.date)).all():
            account=accounts_by_id.get(transaction.account_id); rate=latest_rate(db,transaction.currency,transaction.date)
            if account and rate is not None:
                cashflows.append((transaction.date,-transaction.amount*rate*owner_weight(account,scope,joint_share)))
    if allocation_total>0: cashflows.append((today_value,allocation_total))
    xirr_pct=calculate_xirr(cashflows)

    rooms=[]
    for room in db.scalars(select(ContributionRoom).where(ContributionRoom.year==today_value.year)).all():
        if scope not in {"household","joint"} and room.owner.value != scope: continue
        remaining=room.limit_amount-room.contributed_amount
        rooms.append({"id":room.id,"owner":room.owner.value,"account_type":room.account_type,"beneficiary":room.beneficiary,
                      "limit":room.limit_amount,"contributed":room.contributed_amount,"remaining":remaining,
                      "used_pct":room.contributed_amount/room.limit_amount*100 if room.limit_amount else 0,"currency":room.currency})

    essential_monthly=Decimal("0")
    categories={item.id:item for item in db.scalars(select(Category)).all()}
    multipliers={"weekly":Decimal(52)/12,"biweekly":Decimal(26)/12,"monthly":Decimal(1),"yearly":Decimal(1)/12}
    for item in db.scalars(select(RecurringTransaction).where(RecurringTransaction.active.is_(True))).all():
        account=accounts_by_id.get(item.account_id); category=categories.get(item.category_id)
        if not account or not category or category.is_essential is not True or item.amount >= 0: continue
        weight=owner_weight(account,scope,joint_share); rate=latest_rate(db,item.currency,today_value)
        if weight and rate: essential_monthly += -item.amount*rate*multipliers.get(item.frequency,Decimal(1))*weight
    emergency_months=selected["cash"]/essential_monthly if essential_monthly else None
    diversification=len([value for value in allocation.values() if value>0])
    overdue_count = db.scalar(select(func.count()).select_from(RecurringOccurrence).where(
        RecurringOccurrence.status == "pending", RecurringOccurrence.scheduled_date < today_value)) or 0
    health_components={
        "liquidity": min(100, float((emergency_months or 0)/6*100)),
        "scheduled": max(0,100-overdue_count*10),
        "diversification": min(100,diversification*25),
        "contribution_room": 100 if rooms else 40,
    }
    health_score=round(sum(health_components.values())/len(health_components))
    history=list(db.scalars(select(NetWorthSnapshot).order_by(NetWorthSnapshot.date)).all()); db.commit()
    latest_market_date=db.scalar(select(func.max(MarketPrice.date)))
    latest_fx_date=db.scalar(select(func.max(ExchangeRate.date)))
    latest_transaction_date=db.scalar(select(func.max(Transaction.date)))
    return {"scope":scope,"joint_person_a_share":joint_share,"summary":selected,"ownership":ownership,
            "forecast":{"days":days,"starting_balance":liquid,"minimum_balance":min((row["balance"] for row in forecast),default=liquid),"rows":forecast},
            "available_to_spend":{"amount":available_to_spend,"liquid":liquid,"committed_outflows":committed_outflows,
                                  "until":first_income_date,"irregular_reserve":irregular_reserve,"emergency_fund":emergency_target},
            "net_worth_history":[{"date":row.date,"total_cad":row.total_cad,"cash_cad":row.cash_cad,"investments_cad":row.investments_cad,"debts_cad":row.debts_cad} for row in history],
            "allocation":[{"asset_class":key,"value_cad":value,"percentage":value/allocation_total*100 if allocation_total else 0} for key,value in sorted(allocation.items())],
            "investment_targets":targets,"rebalance":rebalance,
            "performance":{"value_cad":total_value,"cost_cad":total_cost,"gain_cad":total_value-total_cost,
                           "income_cad":investment_income,"total_return_cad":total_value-total_cost+investment_income,
                           "return_pct":((total_value-total_cost+investment_income)/total_cost*100) if total_cost else None,
                           "xirr_pct":xirr_pct,"xirr_status":"available" if xirr_pct is not None else "needs_cashflows",
                           "benchmark":benchmark,"positions":performance_accounts,
                           "method":"Rendimiento no realizado basado en costo promedio; no sustituye TWR/XIRR sin historial completo de operaciones."},
            "contribution_rooms":rooms,"health":{"score":health_score,"components":health_components,
            "essential_monthly":essential_monthly,"emergency_months":emergency_months,"overdue_count":overdue_count},
            "freshness":{"market_prices":latest_market_date,"exchange_rates":latest_fx_date,"transactions":latest_transaction_date,
                         "snapshot":today_value,"pending_scheduled":len(occurrences)}}


@router.get("/search")
def global_search(q: str, limit: int = 8, db: Session = Depends(get_db)):
    term=q.strip()
    if len(term)<2: return []
    pattern=f"%{term}%"; output=[]
    for item in db.scalars(select(Account).where(Account.name.ilike(pattern)).limit(limit)).all():
        output.append({"type":"account","id":item.id,"title":item.name,"subtitle":f"{item.institution or 'Cuenta'} · {item.currency}","target":"accounts"})
    for item in db.scalars(select(Transaction).where(or_(Transaction.description.ilike(pattern),Transaction.payee.ilike(pattern))).order_by(Transaction.date.desc()).limit(limit)).all():
        output.append({"type":"transaction","id":item.id,"title":item.description,"subtitle":f"{item.date} · {item.amount} {item.currency}","target":"transactions"})
    for item in db.scalars(select(RecurringTransaction).where(RecurringTransaction.description.ilike(pattern)).limit(limit)).all():
        output.append({"type":"scheduled","id":item.id,"title":item.description,"subtitle":f"{item.frequency} · {item.amount} {item.currency}","target":"scheduled"})
    for item in db.scalars(select(Instrument).where(or_(Instrument.symbol.ilike(pattern),Instrument.name.ilike(pattern))).limit(limit)).all():
        output.append({"type":"instrument","id":item.id,"title":item.symbol,"subtitle":item.name,"target":"investments"})
    for item in db.scalars(select(InformationNote).where(or_(InformationNote.title.ilike(pattern),InformationNote.content.ilike(pattern))).limit(limit)).all():
        output.append({"type":"information","id":item.id,"title":item.title,"subtitle":item.category,"target":"information"})
    return output[:limit]


@router.get("/dashboard")
def dashboard(month: str | None = None, db: Session = Depends(get_db)):
    start, end = month_bounds(month)
    flow_rows = db.execute(select(Transaction.currency,
        func.coalesce(func.sum(Transaction.amount).filter(Transaction.kind == TransactionKind.income), 0),
        func.coalesce(-func.sum(Transaction.amount).filter(Transaction.kind == TransactionKind.expense), 0)
    ).where(Transaction.date >= start, Transaction.date < end).group_by(Transaction.currency)).all()
    active_accounts = db.scalars(select(Account).where(Account.archived.is_(False))).all()
    net_worth: dict[str, Decimal] = {}
    for account in account_values(db, list(active_accounts)):
        net_worth[account.currency] = net_worth.get(account.currency, Decimal("0")) + Decimal(account.balance or 0)
    consolidated_cad=Decimal("0"); missing_rates=[]
    for currency,value in net_worth.items():
        rate=latest_rate(db,currency,date.today())
        if rate is None: missing_rates.append(currency)
        else: consolidated_cad += value*rate
    return {"month": start.strftime("%Y-%m"), "cashflow": [{"currency": c, "income": i, "expenses": e, "savings": i-e} for c, i, e in flow_rows],
            "net_worth": net_worth, "net_worth_cad": consolidated_cad, "missing_rates": missing_rates,
            "recent_transactions": transactions(month=month, limit=8, db=db), "budgets": budgets(month=month, db=db)}
