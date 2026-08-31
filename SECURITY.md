# Security policy

## Supported versions

MAPI is pre-1.0. Security fixes are applied to the latest source revision only.

## Reporting a vulnerability

Do not open a public issue containing account data, database files, credentials, or a
working exploit. Contact the repository owner privately through GitHub and provide the
minimum information needed to reproduce the issue with fictional data.

## Current security boundaries

- The desktop API listens only on `127.0.0.1`.
- The application has no multi-user authentication.
- Local database encryption is not currently provided by MAPI.
- Development builds may be locally signed rather than notarized.

Do not expose the backend to an untrusted network without adding authentication, TLS,
strict CORS, rate limiting, and a deployment-specific threat review.

## Sensitive artifacts

Never attach a real database or backup to an issue. Create a sanitized reproduction or
a fresh fictional database instead.
