# Privacy

MAPI is designed to minimize the movement of personal financial data.

## Stored locally

The desktop application stores accounts, transactions, budgets, schedules, holdings,
retirement assumptions, notes, and backups on the user's Mac. The default database is:

```text
~/Library/Application Support/ca.mapi.finance/mapi.sqlite3
```

## External requests

MAPI may request exchange rates and market prices from public providers. Requests can
include a currency code or public instrument symbol. MAPI is not intended to send
account names, balances, transactions, notes, or identity data with those requests.

Providers receive normal network metadata such as IP address and request time. Their
own privacy policies apply.

## Backups and exports

Database backups and JSON exports contain sensitive data. Users are responsible for
protecting copies placed in email, cloud storage, external drives, or version-control
systems. Full-disk encryption and encrypted backup destinations are recommended.

## Repository policy

The public repository must contain only fictional data. The following are prohibited:

- production databases or backups;
- bank statements and exports;
- account or card numbers;
- real names, birth dates, addresses, salaries, or balances;
- API keys, signing credentials, or `.env` files;
- screenshots containing real household information.

The automated public-repository check is a safeguard, not a guarantee. Every
contributor must inspect staged files before committing.

## Cloud synchronization

CloudKit/iCloud synchronization is a future design and is not currently active. A live
SQLite database must not be placed directly in a shared cloud folder because concurrent
writes can corrupt or roll back data.
