# Roadmap

## Current desktop foundation

- Local macOS runtime with Tauri, FastAPI, and SQLite.
- Accounts, transactions, transfers, categories, rules, and recurring schedules.
- Annual budget and projected-versus-actual reporting.
- Investments, contribution room, prices, allocation, and analysis.
- Retirement projections, information cards, backups, and bilingual UI.

## Near term

- Replace DOM-based translation with typed message catalogs.
- Add generic visual import-column mapping and reusable bank profiles.
- Add split transactions, reconciliation workflow, and bulk review tools.
- Add versioned database migrations and restore compatibility checks.
- Expand automated tests for totals, currencies, transfer pairs, and accessibility.
- Sign and notarize macOS releases.

## Investment depth

- First-class buy, sell, dividend, fee, and corporate-action records.
- Tax lots, realized gains, TWR/MWR, and configurable benchmarks.
- Provider abstraction with cache, rate limits, and source transparency.

## Mobile and synchronization

- iPhone UI after the desktop data model stabilizes.
- Record-level CloudKit synchronization in a private zone.
- Explicit conflict handling, encryption review, and sync diagnostics.

## Out of scope for now

- Public SaaS hosting.
- Automated trading or transaction initiation.
- Financial, tax, or investment advice.
- Storing one active SQLite file in a shared cloud folder.
