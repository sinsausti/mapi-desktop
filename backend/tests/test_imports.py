from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock

from app.models import TransactionKind
from app.services.imports import (fingerprint, parse_csv_file, parse_date, parse_decimal,
                                  parse_investment_purchase, parse_investment_trade)


def test_fingerprint_is_stable_and_account_scoped():
    first = fingerprint("account-a", date(2026, 8, 1), Decimal("-12.50"), "Coffee Shop")
    same = fingerprint("account-a", date(2026, 8, 1), Decimal("-12.5"), " coffee shop ")
    other = fingerprint("account-b", date(2026, 8, 1), Decimal("-12.50"), "Coffee Shop")
    assert first == same
    assert first != other


def test_decimal_parses_common_bank_formats():
    assert parse_decimal("$1,234.56") == Decimal("1234.56")
    assert parse_decimal("-45,20") == Decimal("-45.20")


def test_date_parses_iso_and_slash_dates():
    assert parse_date("2026-08-22") == date(2026, 8, 22)
    assert parse_date("08/22/2026") == date(2026, 8, 22)


def empty_db():
    db = MagicMock()
    db.scalars.return_value.all.return_value = []
    db.scalar.return_value = None
    return db


def test_wealthsimple_credit_card_inverts_purchase_and_marks_payment_as_transfer():
    content = ("transaction_date,post_date,type,details,amount,currency\n"
               "2026-07-02,2026-07-03,Purchase,COFFEE SHOP,12.50,CAD\n"
               "2026-07-06,2026-07-06,Payment,From chequing account,-12.50,CAD\n").encode()

    rows = parse_csv_file(content, "card", empty_db())

    assert rows[0].amount == Decimal("-12.50")
    assert rows[0].kind == TransactionKind.expense
    assert rows[1].amount == Decimal("12.50")
    assert rows[1].kind == TransactionKind.transfer


def test_wealthsimple_investment_trade_is_not_an_expense():
    content = ("date,transaction,description,amount,balance,currency\n"
               "2026-07-21,BUY,VCN bought 2 shares,-142.00,0.01,CAD\n").encode()

    row = parse_csv_file(content, "investment", empty_db())[0]

    assert row.amount == Decimal("-142.00")
    assert row.kind == TransactionKind.transfer
    assert row.currency == "CAD"


def test_wealthsimple_credit_card_keeps_only_settled_refund_effect():
    content = ("transaction_date,post_date,type,details,amount,currency\n"
               "2026-06-10,2026-06-10,Purchase,CODE SCHOOL,225.10,CAD\n"
               "2026-06-10,2026-06-10,Refund initiated,CODE SCHOOL,-225.10,CAD\n"
               "2026-06-10,2026-06-11,Refund settled,CODE SCHOOL,225.10,CAD\n"
               "2026-06-10,2026-06-11,Refund settled,CODE SCHOOL,-225.10,CAD\n").encode()

    rows = parse_csv_file(content, "card", empty_db())

    assert [row.amount for row in rows] == [Decimal("-225.10"), Decimal("225.10")]
    assert all(row.kind == TransactionKind.expense for row in rows)


def test_wealthsimple_buy_description_extracts_holding_change():
    description = "VCN - Vanguard ETF: Bought 29.0869 shares at $71.27 per share (executed at 2026-07-20)"

    assert parse_investment_purchase(description) == ("VCN", Decimal("29.0869"), Decimal("71.27"))


def test_wealthsimple_sell_description_extracts_negative_holding_change():
    description = "VOO - Vanguard ETF: Sold 45.0000 shares at $631.42 per share (executed at 2026-01-05)"

    assert parse_investment_trade(description) == ("VOO", Decimal("45.0000"), Decimal("631.42"), -1)


def test_identical_statement_rows_get_distinct_stable_fingerprints():
    content = ("date,transaction,description,amount,balance,currency\n"
               "2026-06-05,DEP,Deposit,1000.00,3000.01,CAD\n"
               "2026-06-05,DEP,Deposit,1000.00,4000.01,CAD\n").encode()

    rows = parse_csv_file(content, "resp", empty_db())

    assert rows[0].fingerprint != rows[1].fingerprint
    assert rows[0].external_id is None
    assert rows[1].external_id == "occurrence:2"


def test_wealthsimple_contribution_and_generic_interac_are_transfers():
    content = ("date,transaction,description,amount,balance,currency\n"
               "2026-02-27,CONT,Contribution,1234.56,1234.56,CAD\n"
               "2026-02-11,E_TRFOUT,Interac e-Transfer® Out,-321.00,913.56,CAD\n").encode()

    rows = parse_csv_file(content, "cash", empty_db())

    assert all(row.kind == TransactionKind.transfer for row in rows)


def test_rbc_export_reads_currency_descriptions_and_card_payments():
    content = (
        b'"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"\n'
        b'Visa,1000,6/24/2026,,INTERNET PROVIDER,EXAMPLE CITY,-75.25,\n'
        b'Visa,1000,6/25/2026,,PAYMENT - THANK YOU / PAIEMENT - MERCI,,900.00,\n'
        b'Savings,2000,7/2/2026,,DEPOSIT INTEREST,,,0.55\n'
    )
    rows = parse_csv_file(content, "rbc", empty_db())

    assert rows[0].description == "INTERNET PROVIDER EXAMPLE CITY"
    assert rows[0].amount == Decimal("-75.25")
    assert rows[0].currency == "CAD"
    assert rows[0].kind == TransactionKind.expense
    assert rows[1].kind == TransactionKind.transfer
    assert rows[2].amount == Decimal("0.55")
    assert rows[2].currency == "USD"
    assert rows[2].kind == TransactionKind.income
