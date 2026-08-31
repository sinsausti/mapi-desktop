from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import AccountType, Owner, PlanKind, RuleField, RuleOperator, TransactionKind


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: AccountType
    currency: str = "CAD"
    opening_balance: Decimal = Decimal("0")
    institution: str | None = None
    owner: Owner = Owner.household
    account_subtype: str | None = None

    @field_validator("currency")
    @classmethod
    def currency_code(cls, value: str) -> str:
        value = value.upper()
        if value not in {"CAD", "USD", "UYU"}:
            raise ValueError("currency must be CAD, USD or UYU")
        return value


class AccountOut(AccountIn, ORMModel):
    id: str
    archived: bool
    created_at: datetime
    balance: Decimal | None = None
    cash_balance: Decimal | None = None
    holdings_balance: Decimal | None = None


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str = "#64748b"
    is_income: bool = False
    is_essential: bool | None = None
    parent_id: str | None = None


class CategoryOut(CategoryIn, ORMModel):
    id: str


class TransactionIn(BaseModel):
    account_id: str
    category_id: str | None = None
    date: date
    amount: Decimal
    currency: str = "CAD"
    description: str = Field(min_length=1, max_length=300)
    payee: str | None = None
    kind: TransactionKind | None = None
    notes: str | None = None


class TransactionOut(TransactionIn, ORMModel):
    id: str
    kind: TransactionKind
    transfer_id: str | None
    category: CategoryOut | None = None
    account: AccountOut | None = None


class TransferIn(BaseModel):
    from_account_id: str
    to_account_id: str
    date: date
    amount: Decimal = Field(gt=0)
    received_amount: Decimal | None = Field(default=None, gt=0)
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    description: str = "Transfer"


class BudgetIn(BaseModel):
    month: date
    category_id: str
    amount: Decimal = Field(ge=0)
    currency: str = "CAD"


class BudgetOut(BudgetIn, ORMModel):
    id: str
    category: CategoryOut
    spent: Decimal = Decimal("0")


class RecurringIn(BaseModel):
    account_id: str
    category_id: str | None = None
    description: str
    amount: Decimal
    currency: str = "CAD"
    frequency: Literal["weekly", "biweekly", "monthly", "yearly"] = "monthly"
    next_date: date
    active: bool = True


class RecurringConfirmIn(BaseModel):
    transaction_id: str | None = None
    actual_date: date | None = None
    actual_amount: Decimal | None = None


class RuleIn(BaseModel):
    name: str
    field: RuleField = RuleField.description
    operator: RuleOperator = RuleOperator.contains
    value: str
    category_id: str
    amount: Decimal | None = None
    currency: str | None = None
    account_id: str | None = None
    transaction_kind: TransactionKind | None = None
    priority: int = 100
    active: bool = True


class BulkCategorizeIn(BaseModel):
    transaction_ids: list[str]
    category_id: str
    create_rule: bool = False
    rule_name: str | None = None
    rule_value: str | None = None
    operator: RuleOperator = RuleOperator.contains
    match_amount: bool = False
    match_account: bool = False
    match_currency: bool = False
    match_kind: bool = False


class BulkDeleteIn(BaseModel):
    transaction_ids: list[str]


class InstrumentIn(BaseModel):
    symbol: str
    name: str
    currency: str = "CAD"
    asset_class: str = "equity"


class HoldingIn(BaseModel):
    account_id: str
    instrument_id: str
    quantity: Decimal
    average_cost: Decimal = Decimal("0")


class PriceIn(BaseModel):
    instrument_id: str
    date: date
    price: Decimal = Field(gt=0)
    currency: str
    source: str = "manual"


class PlannedItemIn(BaseModel):
    year: int = Field(ge=2000, le=2200)
    month: int = Field(ge=1, le=12)
    kind: PlanKind
    name: str
    amount: Decimal
    maximum_amount: Decimal | None = None
    currency: str = "CAD"
    category_id: str | None = None
    account_id: str | None = None
    owner: Owner = Owner.household
    annual_paid: bool = False
    irregular: bool = False


class PlannedMonthCopyIn(BaseModel):
    year: int = Field(ge=2000, le=2200)
    source_month: int = Field(ge=1, le=12)
    target_months: list[int]


class SavingsGoalIn(BaseModel):
    name: str
    target_amount: Decimal | None = None
    current_amount: Decimal = Decimal("0")
    monthly_contribution: Decimal = Decimal("0")
    currency: str = "CAD"
    target_date: date | None = None
    account_id: str | None = None
    owner: Owner = Owner.household
    active: bool = True


class ExchangeRateIn(BaseModel):
    date: date
    from_currency: str
    to_currency: str = "CAD"
    rate: Decimal = Field(gt=0)
    source: str = "manual"


class ContributionRoomIn(BaseModel):
    year: int
    owner: Owner
    account_type: Literal["TFSA", "FHSA", "RRSP", "RESP"]
    beneficiary: Literal["Child 1", "Child 2"] | None = None
    limit_amount: Decimal
    contributed_amount: Decimal = Decimal("0")
    currency: str = "CAD"


class InformationNoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    category: str = Field(default="General", min_length=1, max_length=80)
    summary: str | None = Field(default=None, max_length=500)
    content: str = Field(min_length=1)


class RetirementProfileIn(BaseModel):
    name: str = Field(default="Plan familiar", min_length=1, max_length=120)
    person_b_birth_date: date | None = None
    person_a_birth_date: date | None = None
    annual_spending: Decimal | None = Field(default=None, gt=0)
    annual_contribution: Decimal | None = Field(default=None, ge=0)
    passive_income: Decimal = Field(default=Decimal("0"), ge=0)
    public_income: Decimal = Field(default=Decimal("0"), ge=0)
    public_income_start_age: int = Field(default=65, ge=60, le=70)
    withdrawal_rate: Decimal = Field(default=Decimal("0.035"), ge=Decimal("0.02"), le=Decimal("0.08"))
    real_return: Decimal = Field(default=Decimal("0.04"), ge=Decimal("-0.02"), le=Decimal("0.12"))
    target_retirement_age: int = Field(default=55, ge=35, le=80)
    retirement_country: str = Field(default="Canada", min_length=1, max_length=80)
    estimated_tax_rate: Decimal = Field(default=Decimal("0.20"), ge=0, le=Decimal("0.60"))
    people: dict = Field(default_factory=dict)


class HouseholdSettingsIn(BaseModel):
    joint_person_a_share: Decimal = Field(default=Decimal("0.50"), ge=0, le=1)
    emergency_fund_target_cad: Decimal = Field(default=Decimal("0"), ge=0)
    benchmark_symbol: str = Field(default="VEQT.TO", min_length=1, max_length=30)


class InvestmentTargetsIn(BaseModel):
    portfolio_key: str = Field(default="household", min_length=1, max_length=80)
    targets: dict[str, Decimal]


class ImportRow(BaseModel):
    date: date
    amount: Decimal
    description: str
    currency: str | None = None
    kind: TransactionKind | None = None
    payee: str | None = None
    external_id: str | None = None
    category_id: str | None = None
    category_confidence: Decimal = Decimal("0")
    suggestion_source: str | None = None
    duplicate: bool = False
    fingerprint: str


class ImportPreview(BaseModel):
    token: str
    filename: str
    file_hash: str
    rows: list[ImportRow]
    detected_format: str


class ImportCommit(BaseModel):
    account_id: str
    filename: str
    file_hash: str
    rows: list[ImportRow]
