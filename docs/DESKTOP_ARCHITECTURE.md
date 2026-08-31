# Desktop and future Apple synchronization

## Current state: macOS

Each installation keeps an independent SQLite database in Application Support. The
active database is never placed directly in iCloud Drive. MAPI owns backup creation so
copies are consistent while the application is running.

## Possible future state: iPhone and CloudKit

```text
Mac SQLite ── local change queue ─┐
                                  ├── private CloudKit zone
iPhone SQLite ─ local change queue ┘
```

A synchronization layer would require stable sync identifiers, logical versions,
tombstones, pending-change queues, idempotent remote application, explicit conflict
resolution, and visible sync health.

Prices and exchange rates are reproducible derived data. Accounts, transactions,
budgets, schedules, notes, and holdings require durable record-level synchronization.

## Requirements before iOS

1. Versioned local database migrations.
2. Restore and migration tests using fictional fixtures.
3. Record-level sync metadata and conflict rules.
4. Private CloudKit containers and an explicit privacy review.
5. Apple Developer signing, entitlements, and distribution.
6. Reconciliation of record counts, balances, net worth, investments, and budgets.

Shared access to one SQLite file is not an acceptable synchronization design.
