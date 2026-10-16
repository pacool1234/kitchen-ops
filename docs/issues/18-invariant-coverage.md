# Every ledger invariant covered by property tests

## Why

M2 is done when "all invariants in section 4 are covered by property-based tests". That should be checked by CI, not claimed.

## Done when

- [ ] A test in `packages/ledger` fails if any of the 7 invariants has no property test named `invariant N: …`
- [ ] `packages/ledger/README.md` lists each invariant with its plain-language property and the test that covers it
- [ ] Coverage report for `packages/ledger` (`pnpm --filter @kitchen-ops/ledger test:coverage`) in the PR, with any untested branch explained
- [ ] The M2 "done when" from spec section 9, checked off with evidence in the PR

## Notes

The last M2 issue: depends on all the others.

Spec: `docs/spec.md` sections 4 and 9. Rules: `.claude/rules/ledger.md`. Workflow: see "How a session works" in `CLAUDE.md`.
