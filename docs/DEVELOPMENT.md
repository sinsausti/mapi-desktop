# Development guide

## Repository layout

```text
backend/                 FastAPI application and tests
frontend/src/            React user interface
frontend/src-tauri/      Tauri host and platform resources
scripts/                 Build helpers
docs/                    User and technical documentation
```

FastAPI uses SQLite in the desktop application. The previous Docker/PostgreSQL edition
is preserved separately as project history and is not part of this repository.

## Requirements

- macOS 13+
- Xcode Command Line Tools
- Node.js 20.19+ or 22.12+
- Rust stable
- Python 3.12+

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Build the static frontend:

```bash
npm run build
```

## Backend

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/pytest backend/tests
```

The backend reads `DATABASE_URL`. Never place a real database or secret in the
repository.

## Desktop sidecar

```bash
python3 -m venv backend/.venv-desktop
backend/.venv-desktop/bin/pip install -r backend/requirements-desktop.txt
./scripts/build-sidecar.sh
```

The generated backend belongs under
`frontend/src-tauri/resources/mapi-backend/` and is ignored by Git. Tauri bundles it
as a localhost-only sidecar.

```bash
cd frontend
npm run desktop:dev
npm run desktop:build
```

Generated `.app`, `.dmg`, `target`, `dist`, and embedded-sidecar resources must not be
committed. Publish distributable binaries through GitHub Releases after signing and
notarization.

## Checks before a pull request

```bash
cd frontend && npm run build
cd ..
backend/.venv/bin/pytest backend/tests
git diff --check
```

Also run the privacy check:

```bash
./scripts/check-public-repo.sh
```

## Data and migrations

MAPI is pre-1.0. Schema changes must preserve existing desktop data or include an
explicit migration and rollback strategy. Back up a test database before migration
tests. Never use a production household database as a fixture.

## Language

English is the default language. Spanish is supported through the interface
translation layer. New user-facing text must include an English rendering and must be
tested in both languages, light mode, and dark mode.
