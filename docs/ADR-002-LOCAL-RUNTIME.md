# ADR-002: Local desktop runtime

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

The original browser application required Docker Compose and PostgreSQL. MAPI is a
personal local-first application, so installation and startup complexity created more
friction than value for the primary user experience.

## Decision

Distribute MAPI on macOS through Tauri. Keep React as the UI and package the existing
FastAPI financial engine as a localhost-only sidecar. Use SQLite in Application
Support as the desktop data store.

## Consequences

### Positive

- Native installation and fast startup.
- No Docker requirement for end users.
- One financial engine shared by desktop and development environments.
- Local backups and platform integration.

### Negative

- Sidecar packaging increases build complexity.
- macOS distribution requires signing and notarization.
- Desktop schema changes require explicit SQLite migration tests.
- iOS cannot reuse the Python sidecar unchanged and needs a separate architecture.

## Alternatives considered

- Keep Docker as the only product: operationally simple for developers, too heavy for
  ordinary personal use.
- Rewrite all financial logic in Rust immediately: cleaner bundle, excessive rewrite
  risk.
- Put SQLite directly in iCloud Drive: rejected because file-level synchronization is
  unsafe for concurrent databases.
