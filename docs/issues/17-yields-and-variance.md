# Yields and variance

## Why

The owner's question: "where am I losing money?" Variance compares what was used with what recipes say should have been used.

## Done when

- [ ] Yields: gross quantity drawn from stock = net ÷ yield, for example 150 g of fish at 60% yield draws 250 g. Yield is a fixed-point integer, not a fractional number; the rounding of the result to whole base units is documented and tested
- [ ] Variance per product and period, per spec section 4: actual use, theoretical use, unexplained variance and variance value (unexplained variance × average unit cost, rounded once to cents)
- [ ] Inputs passed in as plain data: opening and closing counts, receipts, transfers in and out, recorded waste, dishes sold and their recipe lines
- [ ] A report: products sorted by variance value, largest loss first
- [ ] One worked example with hand-computed numbers for every formula, in the test name or a comment
- [ ] Property tests: when actual use equals theoretical use plus waste, unexplained variance is zero; variance value has the same sign as unexplained variance

## Notes

Depends on "Money and unit costs as bigint fixed-point" and "Weighted-average cost and negative stock". Recipe, SaleLine and Yields are **Hypothesis** in the spec: keep their types minimal, since discovery may reshape them.

Before writing property tests, list each property as one plain sentence in the plan for the repo owner to check.

Spec: `docs/spec.md` section 4, "Yields" and "Variance". Rules: `.claude/rules/ledger.md`. Workflow: see "How a session works" in `CLAUDE.md`.
