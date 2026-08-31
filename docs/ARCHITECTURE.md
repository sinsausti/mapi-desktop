# Architecture

## Goals

MAPI is a local-first financial application for a single household. The architecture
prioritizes privacy, transparent calculations, offline access, reversible imports,
and a desktop experience that does not require Docker.

## Desktop runtime

```text
┌──────────────── MAPI.app ────────────────┐
│ React UI in Tauri WebView                │
│                │ HTTP on 127.0.0.1       │
│ FastAPI sidecar                          │
│                │ SQLAlchemy              │
│ SQLite in Application Support            │
└──────────────────────────────────────────┘
```

Tauri starts the sidecar with an explicit data directory. The API binds only to
localhost. SQLite is authoritative; the startup snapshot in browser storage is only a
performance optimization.

## Layers

- **UI:** React and TypeScript. Presentation, forms, local theme/language preference.
- **API:** FastAPI. Validation, workflows, imports, backups, and reporting endpoints.
- **Domain/data:** SQLAlchemy models and financial calculation services.
- **Platform host:** Tauri and Rust. Process lifecycle, bundle, and native window.

## Core model

```text
Account ──< Transaction >── Category
   │              │
   │              └── optional linked internal transfer
   ├──< Holding >── Instrument ──< MarketPrice
   └──< RecurringTransaction ──< RecurringOccurrence

PlannedItem ── Category / optional Account
ContributionRoom ── person / account type / beneficiary
InformationNote
RetirementProfile
```

All monetary rows retain their native currency. Consolidated CAD values require a
dated exchange rate. Transfers are represented by linked opposite entries and are not
income or expense.

## Derived data

Account balances, budget actuals, portfolio totals, net worth, forecasts, health
scores, and retirement projections are derived. Source records remain auditable.
Market prices and exchange rates can be refreshed; financial transactions cannot be
silently replaced by derived data.

## Backups

Desktop backups use SQLite's backup mechanism to create consistent copies. MAPI keeps
daily backups, supports manual backups, and creates a safety copy before restore.

## Trust boundary

MAPI has no authentication. Localhost is a deliberate boundary, not a substitute for
security controls in a network deployment. See [Security](../SECURITY.md).
