# MAPI User Guide

This guide describes MAPI Desktop from a user perspective. Names such as Person A,
Person B, Child 1, and Child 2 are placeholders and can represent the members of any
household.

## 1. First launch

MAPI starts a local financial engine and opens the dashboard. A new installation uses
English by default. Use the **EN/ES** control to change language and the sun/moon
control to change theme. Both choices are remembered.

Before entering real data:

1. Create the household's accounts.
2. Create or adapt categories.
3. Configure current exchange rates.
4. Create a manual backup after the initial setup.

## 2. Dashboard

The dashboard summarizes the selected month:

- consolidated net worth in CAD;
- balances in each native currency;
- income, expenses, and savings;
- active accounts;
- monthly budget progress;
- recent activity;
- attention items such as overdue schedules or stale prices.

USD and UYU balances are converted only when a rate is available. MAPI reports a
missing rate instead of silently inventing one.

## 3. Accounts

Supported account types include chequing, savings, cash, credit cards, and
investments. Each account has a currency and an owner: Person A, Person B, Joint, or
Household.

### Balances

For regular accounts:

```text
current balance = opening balance + recorded transactions
```

For investment accounts:

```text
total value = available cash + market value of holdings
```

Changing the opening balance is useful for reconciliation, but it does not create a
transaction. Archive an account to remove it from current totals without deleting its
history. Deletion is permanent and removes dependent records.

## 4. Transactions

Expenses are negative and income is positive from the account's perspective. Filters
can narrow the list by account, type, category, and text.

Internal transfers create two linked entries:

- a negative entry in the source account;
- a positive entry in the destination account.

Credit-card payments should be internal transfers, not expenses, so they do not count
spending twice. Cross-currency transfers require the received amount or exchange rate.

## 5. Categories and rules

Categories are separated into income and expense trees. Parent categories organize
the tree but cannot be assigned directly when they have children. Classification as
essential or non-essential belongs to assignable categories.

Categorization rules can match a merchant or description using:

- starts with;
- contains;
- equals.

Optional amount, currency, account, and transaction-type conditions can make rules
more precise. Lower priority numbers run first. Rules remain local and deterministic.

## 6. Imports and smart review

MAPI accepts CSV, OFX, and QFX files. Always review the preview before committing an
import. Duplicate detection considers the account, date, amount, description, and an
external identifier when one exists.

The smart-review screen groups similar uncategorized transactions. From a group, the
user can apply a category once, apply it to all matching entries and create a rule, or
delete selected records.

Bank exports vary. Verify signs, currencies, dates, and account selection before
confirming. PDF statements are not imported directly.

## 7. Scheduled transactions

Recurring templates support weekly, biweekly, monthly, and yearly schedules. Each
occurrence stays pending until confirmed or skipped. Confirming can:

- link an already imported matching transaction; or
- create a new transaction when no real transaction exists.

Pending schedules affect forecasts but do not change account balances.

## 8. Budget

The annual budget is composed of monthly planned items. Income and expense items
should reference an assignable category. Matching can optionally be restricted to an
owner or an exact account.

For each item, MAPI can show:

- projected amount;
- optional maximum amount;
- actual amount from categorized transactions;
- variance and percentage used.

A month can be copied to selected target months. Only the selected months are
replaced. Review the confirmation carefully before applying a bulk copy.

## 9. Investments

Each investment account keeps available cash separate from holdings. A holding has an
instrument, quantity, average cost, currency, market price, and valuation date.

MAPI calculates:

```text
position value = quantity × current price
unrealized gain = position value − quantity × average cost
account total = available cash + all position values
```

The analysis section can display allocation, target allocation, and purchases that
would move the portfolio toward its targets using only excess cash. It does not
recommend sales or calculate tax consequences.

Market data can fail or become stale. Confirm the symbol, exchange, currency, price
date, and source before making decisions.

## 10. Contribution room

The investment section can track annual TFSA and RRSP room by person and RESP room by
beneficiary. Enter the official limit and actual contributions. MAPI shows used room,
remaining room, and percentage.

These values are user-maintained references. Always reconcile them with official tax
and plan records.

## 11. Analysis

Analysis combines balances, schedules, budgets, and investments to show:

- projected cash over 30, 60, 90, or 180 days;
- current net worth and its history;
- available-to-spend after commitments and protected reserves;
- investment allocation and rebalance gaps;
- performance when sufficient price and cash-flow history exists;
- scenario simulations that do not modify stored data.

Forward projections normally use the latest available exchange rate. Historical
reports should be interpreted using rates appropriate to their dates.

## 12. Retirement

Retirement settings are configurable. Important inputs include current ages, desired
annual spending in today's dollars, annual retirement contributions, passive income,
public-pension estimates, withdrawal rate, expected real return, and target age.

The output is an educational scenario, not a financial plan. It does not fully model
tax brackets, account withdrawal order, sequence-of-returns risk, inflation shocks,
or legislative changes. Compare CPP and OAS values with official Canadian sources and
verify other pensions with their administrators.

## 13. Information

Information cards store notes and plans that belong beside the financial model but do
not affect calculations. They can be filtered, edited, or deleted. Do not use this
section as a password manager or document vault.

## 14. Backups and restore

MAPI keeps automatic daily backups and creates a safety copy before restoring. The
local-data panel also provides:

- JSON export for portable inspection;
- a complete database backup;
- backup history and download;
- restore from a compatible SQLite backup.

Store at least one backup outside the Mac. A backup contains sensitive financial
information and should be encrypted when copied to cloud storage or removable media.

## 15. Troubleshooting

### A total does not add up

Check the native currency, exchange rate, account cash, holdings, archived status, and
opening balance. For investments, add available cash and all positions explicitly.

### Actual budget is zero

Confirm that transactions have the expected category, type, currency, owner/account,
and date. Parent categories cannot receive transactions.

### A scheduled item appears overdue

Confirm it, link it to an imported transaction, or skip it. Editing the recurring
template does not retroactively change confirmed transactions.

### A market price is missing

Verify symbol, exchange suffix, instrument currency, and network availability. A
manual price can be used as a temporary fallback.

### The desktop app does not start

Restart the app. If the problem persists, preserve the database and backups before
reinstalling. Development builds are locally signed and may trigger macOS security
prompts.

## Disclaimer

MAPI is software for record keeping and educational projections. It does not provide
financial, investment, tax, accounting, or legal advice.
