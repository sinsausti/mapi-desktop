import csv
import hashlib
import io
import re
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from ofxparse import OfxParser
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (CategorizationRule, Holding, Instrument, MarketPrice, RuleOperator, Transaction,
                      TransactionKind)
from ..schemas import ImportRow


DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y%m%d")
BUY_PATTERN = re.compile(r"^([A-Z0-9.-]+)\s+-.*?: Bought ([0-9.]+) shares at \$([0-9.]+) per share", re.IGNORECASE)
SELL_PATTERN = re.compile(r"^([A-Z0-9.-]+)\s+-.*?: Sold ([0-9.]+) shares at \$([0-9.]+) per share", re.IGNORECASE)


def fingerprint(account_id: str, when: date, amount: Decimal, description: str, external_id: str | None = None) -> str:
    raw = "|".join(
        [account_id, external_id or "", when.isoformat(), str(amount.quantize(Decimal("0.01"))), description.strip().lower()]
    )
    return hashlib.sha256(raw.encode()).hexdigest()


def parse_date(value: str) -> date:
    cleaned = value.strip().split("T")[0]
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unsupported date: {value}")


def parse_decimal(value: str | None) -> Decimal:
    if not value:
        return Decimal("0")
    cleaned = value.strip().replace("$", "").replace(" ", "")
    if cleaned.count(",") == 1 and "." not in cleaned:
        cleaned = cleaned.replace(",", ".")
    else:
        cleaned = cleaned.replace(",", "")
    try:
        return Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"Invalid amount: {value}") from exc


def apply_rules(db: Session, description: str, payee: str | None, *, account_id: str | None = None,
                amount: Decimal | None = None, currency: str | None = None,
                kind: TransactionKind | None = None) -> str | None:
    rules = db.scalars(
        select(CategorizationRule)
        .where(CategorizationRule.active.is_(True))
        .order_by(CategorizationRule.priority, CategorizationRule.id)
    ).all()
    for rule in rules:
        if rule.amount is not None and amount != rule.amount: continue
        if rule.currency and (currency or "").upper() != rule.currency.upper(): continue
        if rule.account_id and account_id != rule.account_id: continue
        if rule.transaction_kind and kind != rule.transaction_kind: continue
        candidate = description if rule.field.value == "description" else (payee or "")
        candidate, expected = candidate.casefold(), rule.value.casefold()
        matched = (
            expected in candidate if rule.operator == RuleOperator.contains
            else candidate == expected if rule.operator == RuleOperator.equals
            else candidate.startswith(expected)
        )
        if matched:
            return rule.category_id
    return None


def normalized_merchant(value: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9]+", " ", value.upper())
    cleaned = re.sub(r"\b\d{3,}\b", " ", cleaned)
    ignored = {"ON", "BC", "QC", "AB", "CA", "CANADA"}
    return " ".join(token for token in cleaned.split() if token not in ignored)[:100]


def suggest_category(db: Session, description: str, payee: str | None, *, account_id: str | None = None,
                     amount: Decimal | None = None, currency: str | None = None,
                     kind: TransactionKind | None = None) -> tuple[str | None, Decimal, str | None]:
    category_id = apply_rules(db, description, payee, account_id=account_id, amount=amount,
                              currency=currency, kind=kind)
    if category_id: return category_id, Decimal("0.98"), "regla"
    target = normalized_merchant(description)
    if not target: return None, Decimal("0"), None
    candidates = db.scalars(select(Transaction).where(
        Transaction.category_id.is_not(None), Transaction.kind != TransactionKind.transfer
    )).all()
    votes = Counter(item.category_id for item in candidates if normalized_merchant(item.description) == target)
    if not votes: return None, Decimal("0"), None
    category_id, count = votes.most_common(1)[0]
    confidence = Decimal(count) / Decimal(sum(votes.values()))
    return category_id, confidence, "historial"


def parse_investment_trade(description: str) -> tuple[str, Decimal, Decimal, int] | None:
    match, direction = BUY_PATTERN.search(description), 1
    if not match:
        match, direction = SELL_PATTERN.search(description), -1
    if not match: return None
    raw_symbol, quantity, price = match.groups()
    return raw_symbol.upper(), Decimal(quantity), Decimal(price), direction


def parse_investment_purchase(description: str) -> tuple[str, Decimal, Decimal] | None:
    trade = parse_investment_trade(description)
    if not trade or trade[3] != 1: return None
    return trade[:3]


def apply_investment_purchase(db: Session, account_id: str, when: date, description: str, currency: str) -> bool:
    trade = parse_investment_trade(description)
    if not trade: return False
    raw_symbol, quantity, price, direction = trade
    symbol = raw_symbol.upper()
    instrument = db.scalar(select(Instrument).where(Instrument.symbol == symbol))
    if not instrument and currency == "CAD" and not symbol.endswith(".TO"):
        instrument = db.scalar(select(Instrument).where(Instrument.symbol == f"{symbol}.TO"))
    if not instrument:
        instrument = Instrument(symbol=symbol, name=symbol, currency=currency)
        db.add(instrument); db.flush()
    holding = db.scalar(select(Holding).where(Holding.account_id == account_id, Holding.instrument_id == instrument.id))
    if holding:
        if direction == 1:
            total_cost = holding.quantity * holding.average_cost + quantity * price
            holding.quantity += quantity
            holding.average_cost = total_cost / holding.quantity
        else:
            holding.quantity = max(Decimal("0"), holding.quantity - quantity)
    elif direction == 1:
        holding = Holding(account_id=account_id, instrument_id=instrument.id, quantity=quantity, average_cost=price)
        db.add(holding)
    db.flush()
    market_price = db.scalar(select(MarketPrice).where(MarketPrice.instrument_id == instrument.id, MarketPrice.date == when))
    if not market_price:
        db.add(MarketPrice(instrument_id=instrument.id, date=when, price=price, currency=currency, source="wealthsimple_trade"))
        db.flush()
    return True


def parse_csv_file(content: bytes, account_id: str, db: Session) -> list[ImportRow]:
    text = content.decode("utf-8-sig")
    sample = text[:4096]
    dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows: list[ImportRow] = []
    occurrences: dict[tuple[date, Decimal, str], int] = {}
    for source in reader:
        normalized = {str(key).strip().lower().replace("_", " "): (value or "").strip() for key, value in source.items()}
        raw_date = normalized.get("date") or normalized.get("transaction date") or normalized.get("fecha") or ""
        if not raw_date: continue
        when = parse_date(raw_date)
        rbc_description = " ".join(filter(None, [normalized.get("description 1"), normalized.get("description 2")])).strip()
        description = normalized.get("description") or normalized.get("details") or normalized.get("memo") or normalized.get("detalle") or rbc_description or normalized.get("payee") or "Imported transaction"
        payee = normalized.get("payee") or normalized.get("merchant") or None
        if normalized.get("amount"):
            amount = parse_decimal(normalized["amount"])
        elif normalized.get("monto"):
            amount = parse_decimal(normalized["monto"])
        elif normalized.get("cad$") or normalized.get("usd$"):
            amount = parse_decimal(normalized.get("cad$") or normalized.get("usd$"))
        else:
            amount = parse_decimal(normalized.get("credit")) - parse_decimal(normalized.get("debit"))
        transaction_code = normalized.get("transaction", "").upper()
        card_type = normalized.get("type", "").casefold()
        is_credit_card = bool(card_type and normalized.get("details"))
        is_rbc = bool(normalized.get("account type") and normalized.get("account number"))
        if is_rbc:
            account_type = normalized.get("account type", "").casefold()
            primary = normalized.get("description 1", "").casefold()
            currency = "USD" if normalized.get("usd$") else "CAD"
            external_id = normalized.get("cheque number") or None
            payee = normalized.get("description 2") or normalized.get("description 1") or None
            if account_type in {"visa", "mastercard"}:
                kind = TransactionKind.transfer if "payment - thank you" in primary else TransactionKind.expense
            elif primary in {"transfer", "e-trf autodeposit", "funds transfer cr", "investment"}:
                kind = TransactionKind.transfer
            elif "deposit interest" in primary or "payroll deposit" in primary or amount > 0:
                kind = TransactionKind.income
            else:
                kind = TransactionKind.expense
        elif is_credit_card:
            if card_type == "refund initiated" or (card_type == "refund settled" and amount > 0):
                continue
            amount = -amount
            kind = TransactionKind.transfer if card_type == "payment" else TransactionKind.expense
            payee = normalized.get("details") or payee
        elif transaction_code == "E_TRFOUT":
            generic_interac = description.casefold().strip() == "interac e-transfer® out"
            kind = TransactionKind.transfer if generic_interac else TransactionKind.expense
        elif transaction_code == "AFT_OUT" and "canada" in description.casefold():
            kind = TransactionKind.transfer
        elif transaction_code in {"BUY", "SELL", "TRFIN", "TRFOUT", "TRFOUTTF", "TRFINTF", "E_TRFIN", "EFTOUT", "DEP", "EFT", "CONT", "NCDIS", "ROC"}:
            kind = TransactionKind.transfer
        elif transaction_code in {"DIV", "INT", "CASHBACK"}:
            kind = TransactionKind.income
        else:
            kind = TransactionKind.income if amount >= 0 else TransactionKind.expense
        if not is_rbc:
            currency = (normalized.get("currency") or "").upper() or None
            external_id = normalized.get("id") or normalized.get("fitid") or normalized.get("transaction id") or None
        occurrence_key = (when, amount, description.casefold())
        occurrences[occurrence_key] = occurrences.get(occurrence_key, 0) + 1
        if not external_id and occurrences[occurrence_key] > 1:
            external_id = f"occurrence:{occurrences[occurrence_key]}"
        fp = fingerprint(account_id, when, amount, description, external_id)
        duplicate = db.scalar(select(Transaction.id).where(Transaction.account_id == account_id, Transaction.fingerprint == fp)) is not None
        category_id, confidence, source = suggest_category(db, description, payee, account_id=account_id,
                                                            amount=amount, currency=currency, kind=kind)
        rows.append(ImportRow(date=when, amount=amount, description=description, currency=currency, kind=kind, payee=payee, external_id=external_id,
                              category_id=category_id, category_confidence=confidence, suggestion_source=source,
                              duplicate=duplicate, fingerprint=fp))
    return rows


def parse_ofx_file(content: bytes, account_id: str, db: Session) -> list[ImportRow]:
    ofx = OfxParser.parse(io.BytesIO(content))
    rows: list[ImportRow] = []
    for statement in ofx.accounts:
        for item in statement.statement.transactions:
            when = item.date.date()
            amount = Decimal(str(item.amount))
            description = (item.memo or item.payee or "Imported transaction").strip()
            payee = item.payee.strip() if item.payee else None
            external_id = str(item.id) if item.id else None
            fp = fingerprint(account_id, when, amount, description, external_id)
            duplicate = db.scalar(select(Transaction.id).where(Transaction.account_id == account_id, Transaction.fingerprint == fp)) is not None
            kind = TransactionKind.income if amount >= 0 else TransactionKind.expense
            category_id, confidence, source = suggest_category(db, description, payee, account_id=account_id,
                                                                amount=amount, kind=kind)
            rows.append(ImportRow(date=when, amount=amount, description=description, payee=payee, external_id=external_id,
                                  kind=kind, category_id=category_id, category_confidence=confidence,
                                  suggestion_source=source, duplicate=duplicate, fingerprint=fp))
    return rows


def parse_file(filename: str, content: bytes, account_id: str, db: Session) -> tuple[str, list[ImportRow]]:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension in {"csv", "xls"}:
        return "csv", parse_csv_file(content, account_id, db)
    if extension in {"ofx", "qfx"}:
        return extension, parse_ofx_file(content, account_id, db)
    raise ValueError("Supported formats: CSV, OFX and QFX")
