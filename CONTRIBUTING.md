# Contributing to MAPI

Thank you for helping improve MAPI.

## Ground rules

- Use English for source documentation, commit messages, and new default UI copy.
- Keep Spanish translations equivalent and current.
- Use fictional financial data in tests, screenshots, and examples.
- Do not commit databases, statements, exports, backups, credentials, or generated
  application bundles.
- Preserve local-first behavior unless an architectural decision explicitly changes it.
- Explain financial calculations and avoid silent assumptions.

## Workflow

1. Create a focused branch.
2. Add or update tests.
3. Run frontend build, backend tests, and the public-repository check.
4. Document user-visible behavior.
5. Open a pull request describing the problem, implementation, validation, and data
   migration impact.

## Financial behavior

Changes affecting balances, transfers, currency conversion, budget matching,
investment valuation, or retirement projections must include worked examples and
tests for analogous records—not only the reported case.

## License

By contributing, you agree that your contribution is licensed under AGPL-3.0.
