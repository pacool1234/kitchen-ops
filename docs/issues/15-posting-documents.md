# Posting documents

## Why

Every stock change comes from a document. Posting turns a document's lines into movements, completely or not at all. This issue covers invariants 2, 4 and 7.

## Done when

- [ ] `Document` and `DocumentLine` types per spec section 3, with statuses draft, review and posted
- [ ] Posting returns either the posted document and all its movements, or an error and no movements. Never part of them
- [ ] Movements per document type: a delivery note adds stock; waste removes it; a count posts the difference between counted and on-hand stock; a transfer posts a matching pair (out of one storeroom, into another)
- [ ] Reversing a posted document produces a reversing movement for each of its movements; a correction is the reversal plus a new posted document
- [ ] Property test, invariant 2: every movement produced by posting references a line of a posted document
- [ ] Property test, invariant 4: if any line fails (unknown unit, non-whole quantity…), posting returns no movements; if it succeeds, every line produced its movements
- [ ] Property test, invariant 7: posting and reversing never change a posted document (deep equality before and after)

## Notes

Depends on "Unit conversions" and "Movements and stock on hand". Invoices, and whether they create movements or only correct prices, wait for the discovery session (spec section 3, "Assumption to validate"); sales imports feed variance, not movements.

Name each invariant's property test `invariant N: …`. Before writing property tests, list each property as one plain sentence in the plan for the repo owner to check.

Spec: `docs/spec.md` sections 3 and 4. Rules: `.claude/rules/ledger.md`. Workflow: see "How a session works" in `CLAUDE.md`.
