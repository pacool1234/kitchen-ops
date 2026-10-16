# Movements and stock on hand

## Why

Movements are the ledger's single source of truth: stock is never stored, only summed. This issue covers invariants 1, 3 and 5.

## Done when

- [ ] `Movement` type per spec section 3: product, storeroom, signed quantity in base units, unit cost, document line, kind, and the movement it reverses (if any). Readonly; IDs and dates are passed in, never generated (no I/O, no clock)
- [ ] Stock on hand per product and storeroom = the sum of its movements
- [ ] A function that builds the reversing movement for a given movement; reversing a movement twice, or reversing a reversal, is rejected
- [ ] No function updates or removes a movement
- [ ] Property test, invariant 1: a running balance applied movement by movement always equals the full sum
- [ ] Property test, invariant 3: a movement plus its reversal nets to zero, and the original is unchanged
- [ ] Property test, invariant 5: replaying the same movements in the same order gives the same stock

## Notes

Product and Storeroom are still **Hypothesis** in the spec: refer to them by ID only, with no other fields.

Name each invariant's property test `invariant N: …` (see the coverage issue). Before writing property tests, list each property as one plain sentence in the plan for the repo owner to check.

Spec: `docs/spec.md` sections 3 and 4. Rules: `.claude/rules/ledger.md`. Workflow: see "How a session works" in `CLAUDE.md`.
