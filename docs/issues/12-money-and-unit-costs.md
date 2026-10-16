# Money and unit costs as bigint fixed-point

## Why

Every cost, valuation and variance figure is built on these types. They must be exact before anything uses them.

## Done when

- [ ] Decision record 0015: money totals are `bigint` cents and unit costs are `bigint` millionths of a euro per base unit (6 decimal places), with no decimal library. It replaces "a decimal library in TypeScript" in spec section 4 (**Decided**); spec section 4 and `.claude/rules/ledger.md` are updated to point to it
- [ ] `Money` (cents) and `UnitCost` (6 decimal places) types in `packages/ledger`, with parsing from and formatting to decimal strings (`"12.50"`, `"0.018500"`). No JavaScript `number` goes in or out, except quantities (decision 0010)
- [ ] One shared rounding function, with its rule written in decision 0015 and covered by example tests at every tie (…5 cases, negative values)
- [ ] Line total: quantity × unit price − discount, rounded once to cents, with example tests using hand-computed numbers
- [ ] Property tests: formatting then parsing gives back the same value; addition and subtraction of money are exact (commutative, associative, zero is neutral); a rounded result is never more than half a cent from the exact one
- [ ] No runtime dependency added to `packages/ledger`

## Notes

Rounding mode is open: Claude proposes one in the plan (Spanish invoices usually round half away from zero) and the repo owner decides.

Converting at the boundaries (JSON as decimal strings, Postgres `numeric`) belongs to later API work, not this issue.

Spec: `docs/spec.md` section 4, "Numeric representation". Rules: `.claude/rules/ledger.md`. Workflow: see "How a session works" in `CLAUDE.md`.
