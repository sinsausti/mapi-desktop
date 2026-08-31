import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uid() -> str:
    return str(uuid.uuid4())


class AccountType(str, enum.Enum):
    checking = "checking"
    savings = "savings"
    credit_card = "credit_card"
    cash = "cash"
    investment = "investment"


class Owner(str, enum.Enum):
    person_a = "person_a"
    person_b = "person_b"
    joint = "joint"
    household = "household"


class PlanKind(str, enum.Enum):
    income = "income"
    expense = "expense"
    investment = "investment"
    saving = "saving"


class TransactionKind(str, enum.Enum):
    income = "income"
    expense = "expense"
    transfer = "transfer"


class RuleField(str, enum.Enum):
    description = "description"
    payee = "payee"


class RuleOperator(str, enum.Enum):
    contains = "contains"
    equals = "equals"
    starts_with = "starts_with"


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    type: Mapped[AccountType] = mapped_column(Enum(AccountType))
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=0)
    institution: Mapped[str | None] = mapped_column(String(120), nullable=True)
    owner: Mapped[Owner] = mapped_column(Enum(Owner), default=Owner.household)
    account_subtype: Mapped[str | None] = mapped_column(String(40), nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    color: Mapped[str] = mapped_column(String(7), default="#64748b")
    is_income: Mapped[bool] = mapped_column(Boolean, default=False)
    is_essential: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"), nullable=True)


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    filename: Mapped[str] = mapped_column(String(255))
    file_hash: Mapped[str] = mapped_column(String(64), unique=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    imported_count: Mapped[int] = mapped_column(default=0)
    skipped_count: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("account_id", "fingerprint", name="uq_transaction_fingerprint"),
        Index("ix_transactions_date", "date"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    description: Mapped[str] = mapped_column(String(300))
    payee: Mapped[str | None] = mapped_column(String(160), nullable=True)
    kind: Mapped[TransactionKind] = mapped_column(Enum(TransactionKind))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    transfer_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    import_batch_id: Mapped[str | None] = mapped_column(ForeignKey("import_batches.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    account: Mapped[Account] = relationship()
    category: Mapped[Category | None] = relationship()


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("month", "category_id", name="uq_budget_month_category"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    month: Mapped[date] = mapped_column(Date)
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    category: Mapped[Category] = relationship()


class RecurringTransaction(Base):
    __tablename__ = "recurring_transactions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    description: Mapped[str] = mapped_column(String(300))
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    frequency: Mapped[str] = mapped_column(String(20), default="monthly")
    next_date: Mapped[date] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class RecurringOccurrence(Base):
    __tablename__ = "recurring_occurrences"
    __table_args__ = (UniqueConstraint("recurring_id", "scheduled_date", name="uq_recurring_occurrence_date"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    recurring_id: Mapped[str] = mapped_column(ForeignKey("recurring_transactions.id"), index=True)
    scheduled_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    transaction_id: Mapped[str | None] = mapped_column(ForeignKey("transactions.id"), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    recurring: Mapped[RecurringTransaction] = relationship()


class CategorizationRule(Base):
    __tablename__ = "categorization_rules"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120))
    field: Mapped[RuleField] = mapped_column(Enum(RuleField), default=RuleField.description)
    operator: Mapped[RuleOperator] = mapped_column(Enum(RuleOperator), default=RuleOperator.contains)
    value: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"))
    amount: Mapped[Decimal | None] = mapped_column(Numeric(19, 4), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    transaction_kind: Mapped[TransactionKind | None] = mapped_column(Enum(TransactionKind), nullable=True)
    priority: Mapped[int] = mapped_column(default=100)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Instrument(Base):
    __tablename__ = "instruments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    symbol: Mapped[str] = mapped_column(String(30), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    asset_class: Mapped[str] = mapped_column(String(40), default="equity")


class Holding(Base):
    __tablename__ = "holdings"
    __table_args__ = (UniqueConstraint("account_id", "instrument_id", name="uq_holding_account_instrument"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    instrument_id: Mapped[str] = mapped_column(ForeignKey("instruments.id"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(24, 8))
    average_cost: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=0)
    instrument: Mapped[Instrument] = relationship()
    account: Mapped[Account] = relationship()


class MarketPrice(Base):
    __tablename__ = "market_prices"
    __table_args__ = (UniqueConstraint("instrument_id", "date", name="uq_price_instrument_date"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    instrument_id: Mapped[str] = mapped_column(ForeignKey("instruments.id"))
    date: Mapped[date] = mapped_column(Date)
    price: Mapped[Decimal] = mapped_column(Numeric(19, 6))
    currency: Mapped[str] = mapped_column(String(3))
    source: Mapped[str] = mapped_column(String(40), default="manual")


class PlannedItem(Base):
    __tablename__ = "planned_items"
    __table_args__ = (UniqueConstraint("year", "month", "kind", "name", "owner", name="uq_planned_item"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    year: Mapped[int] = mapped_column(index=True)
    month: Mapped[int] = mapped_column()
    kind: Mapped[PlanKind] = mapped_column(Enum(PlanKind))
    name: Mapped[str] = mapped_column(String(160))
    amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    maximum_amount: Mapped[Decimal | None] = mapped_column(Numeric(19, 4), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    category_id: Mapped[str | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    owner: Mapped[Owner] = mapped_column(Enum(Owner), default=Owner.household)
    annual_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    irregular: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[Category | None] = relationship()


class SavingsGoal(Base):
    __tablename__ = "savings_goals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160))
    target_amount: Mapped[Decimal | None] = mapped_column(Numeric(19, 4), nullable=True)
    current_amount: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=0)
    monthly_contribution: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=0)
    currency: Mapped[str] = mapped_column(String(3), default="CAD")
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    account_id: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    owner: Mapped[Owner] = mapped_column(Enum(Owner), default=Owner.household)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"
    __table_args__ = (UniqueConstraint("date", "from_currency", "to_currency", name="uq_exchange_rate"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    date: Mapped[date] = mapped_column(Date)
    from_currency: Mapped[str] = mapped_column(String(3))
    to_currency: Mapped[str] = mapped_column(String(3), default="CAD")
    rate: Mapped[Decimal] = mapped_column(Numeric(20, 10))
    source: Mapped[str] = mapped_column(String(40), default="manual")


class ContributionRoom(Base):
    __tablename__ = "contribution_rooms"
    __table_args__ = (UniqueConstraint("year", "owner", "account_type", "beneficiary", name="uq_contribution_room_beneficiary"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    year: Mapped[int] = mapped_column()
    owner: Mapped[Owner] = mapped_column(Enum(Owner))
    account_type: Mapped[str] = mapped_column(String(20))
    beneficiary: Mapped[str] = mapped_column(String(20), default="")
    limit_amount: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    contributed_amount: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=0)
    currency: Mapped[str] = mapped_column(String(3), default="CAD")


class InformationNote(Base):
    __tablename__ = "information_notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(80), default="General")
    summary: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class RetirementProfile(Base):
    __tablename__ = "retirement_profiles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(120), default="Plan familiar")
    person_b_birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    person_a_birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    annual_spending: Mapped[Decimal | None] = mapped_column(Numeric(19, 2), nullable=True)
    annual_contribution: Mapped[Decimal | None] = mapped_column(Numeric(19, 2), nullable=True)
    passive_income: Mapped[Decimal] = mapped_column(Numeric(19, 2), default=0)
    public_income: Mapped[Decimal] = mapped_column(Numeric(19, 2), default=0)
    public_income_start_age: Mapped[int] = mapped_column(default=65)
    withdrawal_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("0.035"))
    real_return: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("0.04"))
    target_retirement_age: Mapped[int] = mapped_column(default=55)
    retirement_country: Mapped[str] = mapped_column(String(80), default="Canada")
    estimated_tax_rate: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("0.20"))
    people_config: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MigrationBatch(Base):
    __tablename__ = "migration_batches"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    filename: Mapped[str] = mapped_column(String(255))
    file_hash: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(20), default="committed")
    summary: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class HouseholdSettings(Base):
    __tablename__ = "household_settings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    joint_person_a_share: Mapped[Decimal] = mapped_column(Numeric(6, 4), default=Decimal("0.50"))
    emergency_fund_target_cad: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=0)
    benchmark_symbol: Mapped[str] = mapped_column(String(30), default="VEQT.TO")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InvestmentTarget(Base):
    __tablename__ = "investment_targets"
    __table_args__ = (UniqueConstraint("portfolio_key", "asset_class", name="uq_investment_target_portfolio_asset"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    portfolio_key: Mapped[str] = mapped_column(String(80), default="household", index=True)
    asset_class: Mapped[str] = mapped_column(String(40))
    target_percentage: Mapped[Decimal] = mapped_column(Numeric(6, 3))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class NetWorthSnapshot(Base):
    __tablename__ = "net_worth_snapshots"
    __table_args__ = (UniqueConstraint("date", name="uq_net_worth_snapshot_date"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    date: Mapped[date] = mapped_column(Date, index=True)
    total_cad: Mapped[Decimal] = mapped_column(Numeric(19, 4))
    cash_cad: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=0)
    investments_cad: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=0)
    debts_cad: Mapped[Decimal] = mapped_column(Numeric(19, 4), default=0)
    breakdown: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
