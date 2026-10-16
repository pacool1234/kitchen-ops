# 0016. `extract` may depend on `ledger`

- Status: Accepted
- Date: 2026-10-16

## Context

Spec section 2 (**Decided**) says `extract` depends only on `shared`. Spec section 5, stage 4, makes `extract` validate every result before it is trusted: line totals = quantity × unit price − discount, lines add up to the document, VAT adds up.

A line total must be checked with exactly the rule the ledger uses when the document is posted: `lineTotal` in `packages/ledger`, worked out exactly and rounded once to cents, half away from zero (decision 0015). If `extract` had its own copy, the two could drift apart. A line could then pass validation and be posted at a different cost, or fail validation although the ledger would agree with it.

The eval (also in `extract`) needs the same checks to compute the silent error rate, so validation can't move to `api`.

## Decision

`extract` may depend on `ledger` as well as `shared`. The dependency rules become:
- `ledger` depends on nothing;
- `extract` on `ledger` and `shared`;
- `api` on `ledger`, `extract` and `shared`;
- `web` only on `shared`.

The lint rule in `eslint.config.mjs` enforces the new rule. Spec section 2 and `CLAUDE.md` say the same.

This widens nothing else. The ledger is pure TypeScript with no dependencies and no I/O, so `extract` gains no database, network or framework through it. The ledger still depends on nothing, so there is no cycle.

## Alternatives considered

- **A copy of the money rules in `extract`:** two implementations of one rounding rule, which is what decision 0015 set out to avoid.
- **Moving money into `shared`:** the ledger would then depend on `shared`, breaking "ledger depends on nothing", and `shared` would pull Zod into the ledger.
- **Validating in `api`:** the eval runs without the API, and it needs the same checks to tell a silent error from a result sent to review.
