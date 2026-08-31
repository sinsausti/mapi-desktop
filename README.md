# MAPI

**Money, Assets, Planning & Investments**
*Your family financial map.*

[Español](README.es.md) · [User guide](docs/USER_GUIDE.md) · [Development](docs/DEVELOPMENT.md) · [Architecture](docs/ARCHITECTURE.md)

MAPI is a private, local-first personal finance application for household budgeting,
cash-flow planning, investments, and retirement projections. It was created to replace
an increasingly difficult spreadsheet while keeping financial data under the user's
control.

## Why MAPI exists

I wanted a personal finance and investment application that could adapt closely to my
household's needs without remaining trapped in an increasingly complex spreadsheet. I
had purchased an application that came close to what I wanted, but its investment
tracking was not detailed enough for the way I manage accounts and portfolios.

I contacted its developers and described the investment features that I believed would
complete the product. They said they would evaluate the proposal, but after several
months there was no further news. Rather than continue waiting or keep extending the
spreadsheet, I decided to build the application I needed. That decision became MAPI: a
local-first financial system designed around budgeting, cash flow, investments, and
long-term planning in one place.

MAPI was created by me: **Sebastian Insausti**

## Platform

MAPI Desktop currently supports **Apple Silicon Macs running macOS 13 or later**. It
is a native macOS application built with Tauri. React provides the interface, FastAPI
runs as a localhost-only sidecar, and SQLite stores the data in the user's Application
Support directory.

Windows, Linux and Intel Macs are not supported by the current build.

> [!IMPORTANT]
> MAPI is currently designed for one household on one device. It has no user
> authentication and must not be exposed directly to the public Internet.

## Highlights

- CAD, USD, and UYU accounts with consolidated net worth in CAD.
- Monthly and annual budgets with projected-versus-actual tracking.
- Income, expenses, internal transfers, recurring schedules, and confirmations.
- Hierarchical categories and deterministic categorization rules.
- CSV, OFX, and QFX import preview with duplicate detection.
- Investment accounts, cash, holdings, market prices, allocation, and rebalancing.
- TFSA, RRSP, and RESP contribution-room tracking.
- Cash-flow forecasting, financial health checks, and scenario analysis.
- Configurable retirement projections with CPP, OAS, employer pensions, and BPS.
- Automatic local backups, manual backups, restore, and JSON export.
- English-first bilingual interface with Spanish support.
- Light and dark themes.

See the [complete user guide](docs/USER_GUIDE.md) for workflows and calculation notes.

## Privacy model

MAPI does not require a cloud account. The desktop database is stored locally at:

```text
~/Library/Application Support/ca.mapi.finance/mapi.sqlite3
```

Market prices and exchange rates may be requested from public providers. Financial
records are not intentionally sent to those providers. Read [Privacy](docs/PRIVACY.md)
and [Security](SECURITY.md) before using real data.

## Build the macOS app from source

### 1. Install the requirements

- Apple Silicon Mac with macOS 13 or later
- Xcode Command Line Tools
- Node.js 20.19+ or 22.12+
- Rust stable
- Python 3.12+

Verify the tools before continuing:

```bash
xcodebuild -version
node --version
npm --version
rustc --version
cargo --version
python3 --version
```

If the Xcode Command Line Tools are missing, install them with:

```bash
xcode-select --install
```

### 2. Clone the repository

```bash
git clone https://github.com/sinsausti/mapi-desktop.git
cd mapi-desktop
```

### 3. Install the frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 4. Build the local backend bundled with MAPI

```bash
./scripts/build-sidecar.sh
```

This creates an Apple Silicon backend inside Tauri's generated resources. The command
creates its own Python environment and installs the required Python packages.

### 5. Generate `MAPI.app`

```bash
cd frontend
npm run desktop:build
```

When the build succeeds, the application is available at:

```text
frontend/src-tauri/target/release/bundle/macos/MAPI.app
```

The application is not signed or notarized by default, so macOS may require explicit
approval the first time it is opened. Signing, notarization, and creation of a DMG are
separate release steps required before distributing a trusted public installer.

For development mode, tests, troubleshooting, and generated-file rules, read
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Current regional scope

MAPI is currently optimized for a Canadian household with financial ties to Uruguay.
Its built-in currencies are CAD, USD, and UYU; contribution accounts include TFSA,
FHSA, RRSP, and RESP; and retirement planning includes CPP, OAS, employer pensions,
and BPS. Amounts, limits, ages, rates, and assumptions are editable, but these lists
are not yet configurable through the interface.

## Project status

MAPI is pre-1.0 software. Database and API compatibility may change. Create a backup
before upgrading and do not rely on projections as financial, tax, or investment
advice.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). Contributions must use fictional data and
must never include statements, account numbers, personal names, or production
databases.

## License

MAPI is licensed under the [GNU Affero General Public License v3.0](LICENSE). See the
[copyright notice](NOTICE) for attribution.

Copyright © 2026 Sebastian Insausti.
