# Validation checks before trusting a result

## Why

A result that looks right but isn't corrupts the stock figures silently. Before a result is trusted, it must pass arithmetic and plausibility checks; anything that fails goes to review, with the failing check named (spec section 5, stage 4).

## Done when

- [ ] **Decision record 0016: `extract` may depend on `ledger`.**
  - Line totals must be checked with exactly the ledger's rule (`lineTotal`: rounded once to cents, half away from zero). Rewriting it in `extract` would let the two drift apart.
  - The ledger is pure and has no dependencies, so this widens nothing else.
  - The record also updates spec section 2's dependency rule (**Decided**) and the lint rule.
- [ ] Pure functions in `packages/extract`, each a named check, together returning every check that failed with its details:
  - **Line total:** quantity × unit price − discount equals the printed line total, to the cent.
  - **Lines add up:** the line totals sum to the net amount.
  - **VAT:** each rate's base × rate equals its amount to the cent, and the bases sum to the net.
  - **Total:** net + VAT = total.
  - **Tax ID:** the supplier's NIF, NIE or CIF passes its checksum.
  - **Date:** not in the future and not implausibly old. "Today" and the limit are passed in.
  - **Duplicate:** the document number isn't already known for that supplier. The known numbers are passed in.
  - **Missing value:** a required value is `null` (see "Extraction result schema").
- [ ] Example tests with hand-computed numbers for every check, passing and failing.
- [ ] Property tests:
  - every valid tax ID with any single character changed fails the checksum;
  - a result built to add up passes every arithmetic check;
  - changing any one amount in it by a cent fails at least one.

## Notes

Delivery notes without prices skip the price checks: the plan should define which checks apply to which document type. Check messages may show values (for the review screen), but eval summaries name only the check, never document contents (`.claude/rules/extract.md`).

Depends on "Extraction result schema".

Spec: `docs/spec.md` sections 2 and 5. Rules: `.claude/rules/extract.md`. Workflow: see "How a session works" in `CLAUDE.md`.
