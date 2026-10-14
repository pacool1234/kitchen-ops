---
paths:
  - "packages/ledger/**"
---

# Ledger package rules

Spec: `docs/spec.md` section 4. These rules restate it for this package.

## Purity

- No I/O of any kind: no database, filesystem, network, `Date.now()` or randomness. Time and IDs are passed in as arguments.
- Zero runtime dependencies except a decimal library. Ask before adding any other.

## Numbers

- Quantities: integers in the product's base unit (g, ml, or thousandths of a unit). Use `bigint` or validated safe integers; never fractional numbers.
- Money totals: integer cents. Unit costs: decimal with 6 places via the decimal library.
- Rounding only at the documented points (line totals, document totals), using one shared rounding function with its own tests.

## Invariants to keep true and tested

1. Stock on hand = sum of movements.
2. Every movement references a posted document line.
3. Movements are never mutated; corrections are a reversing movement plus a new one.
4. Posting a document is all-or-nothing.
5. Replaying the same movements in the same order gives the same stock and cost.
6. Negative stock only through a flagged adjustment.
7. Posted documents are immutable.

## Costing

- Weighted average per product and storeroom. If stock is zero or negative before a receipt, the new average is the received unit cost.
- Recipe costing uses the latest purchase price, a separate function from stock valuation.

## Testing workflow

- Write the test before the implementation. For each invariant, a fast-check property test; for each formula, example tests with hand-computed numbers in the test name or a comment.
- When proposing a property, state it in one plain sentence first so the repo owner can check it before code is written.
- A failing property test is a finding, not an inconvenience: report the shrunk counterexample, never weaken the property to make it pass without approval.
