from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def migrate_legacy_schema() -> None:
    """Compatibility bridge for databases created by the first MVP."""
    inspector = inspect(engine)
    with engine.begin() as connection:
        if "accounts" in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns("accounts")}
            if "owner" not in columns:
                connection.execute(text("ALTER TABLE accounts ADD COLUMN owner VARCHAR(12) NOT NULL DEFAULT 'household'"))
            if "account_subtype" not in columns:
                connection.execute(text("ALTER TABLE accounts ADD COLUMN account_subtype VARCHAR(40)"))
            if "archived" not in columns:
                connection.execute(text("ALTER TABLE accounts ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE"))
        if "categories" in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns("categories")}
            if "is_essential" not in columns:
                connection.execute(text("ALTER TABLE categories ADD COLUMN is_essential BOOLEAN"))
            if "parent_id" not in columns:
                connection.execute(text("ALTER TABLE categories ADD COLUMN parent_id VARCHAR(36)"))
        if "planned_items" in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns("planned_items")}
            if "maximum_amount" not in columns:
                connection.execute(text("ALTER TABLE planned_items ADD COLUMN maximum_amount NUMERIC(19, 4)"))
            if "irregular" not in columns:
                connection.execute(text("ALTER TABLE planned_items ADD COLUMN irregular BOOLEAN NOT NULL DEFAULT FALSE"))
        if "contribution_rooms" in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns("contribution_rooms")}
            if "beneficiary" not in columns:
                connection.execute(text("ALTER TABLE contribution_rooms ADD COLUMN beneficiary VARCHAR(20) NOT NULL DEFAULT ''"))
        if "categorization_rules" in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns("categorization_rules")}
            if "amount" not in columns:
                connection.execute(text("ALTER TABLE categorization_rules ADD COLUMN amount NUMERIC(19, 4)"))
            if "currency" not in columns:
                connection.execute(text("ALTER TABLE categorization_rules ADD COLUMN currency VARCHAR(3)"))
            if "account_id" not in columns:
                connection.execute(text("ALTER TABLE categorization_rules ADD COLUMN account_id VARCHAR(36) REFERENCES accounts(id)"))
            if "transaction_kind" not in columns:
                connection.execute(text("ALTER TABLE categorization_rules ADD COLUMN transaction_kind transactionkind"))
        if "retirement_profiles" in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns("retirement_profiles")}
            if "retirement_country" not in columns:
                connection.execute(text("ALTER TABLE retirement_profiles ADD COLUMN retirement_country VARCHAR(80) NOT NULL DEFAULT 'Canada'"))
            if "estimated_tax_rate" not in columns:
                connection.execute(text("ALTER TABLE retirement_profiles ADD COLUMN estimated_tax_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.20"))
            if "people_config" not in columns:
                connection.execute(text("ALTER TABLE retirement_profiles ADD COLUMN people_config TEXT NOT NULL DEFAULT '{}'"))
        if "household_settings" in inspector.get_table_names():
            columns = {column["name"] for column in inspector.get_columns("household_settings")}
            if "emergency_fund_target_cad" not in columns:
                connection.execute(text("ALTER TABLE household_settings ADD COLUMN emergency_fund_target_cad NUMERIC(19, 4) NOT NULL DEFAULT 0"))
            if "benchmark_symbol" not in columns:
                connection.execute(text("ALTER TABLE household_settings ADD COLUMN benchmark_symbol VARCHAR(30) NOT NULL DEFAULT 'VEQT.TO'"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
