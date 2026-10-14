# Vitest and fast-check baseline

## Why

Set up testing so property-based tests can start in M2.

## Done when

- [ ] Vitest configured per package (or a root workspace config) and `pnpm test` runs every package
- [ ] `fast-check` installed in `packages/ledger` only
- [ ] One example test and one trivial property test in `packages/ledger` (e.g. adding zero leaves a quantity unchanged), both passing
- [ ] Coverage report available with `pnpm --filter @kitchen-ops/ledger test -- --coverage`

## Notes

Repo owner wants to write the first property test himself: leave the property body as a clearly marked TODO with the plain-language statement, and pair on it in the session.

Spec: `docs/spec.md`. Workflow: see "How a session works" in `CLAUDE.md`.
