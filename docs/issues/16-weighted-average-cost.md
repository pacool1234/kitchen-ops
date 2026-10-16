# Weighted-average cost and negative stock

## Why

"What is my stock worth?" Each product's average cost per storeroom, recalculated by replaying movements. This issue also covers invariant 6 and the cost half of invariant 5.

## Done when

- [ ] Received unit cost = line total after discount ÷ quantity in base units, rounded to 6 decimal places with the shared rounding function ("Money and unit costs as bigint fixed-point")
- [ ] Average cost per product and storeroom by replaying movements, using the spec's formula; if stock is zero or negative before a receipt, the new average is the received unit cost
- [ ] Outgoing movements (waste, transfers out, count losses) are valued at the current average; a transfer carries that cost into the other storeroom
- [ ] Example tests with hand-computed numbers, for example: 10 kg at €2.00/kg, then 5 kg at €3.20/kg → €2.40/kg
- [ ] Invariant 6: a movement that would take stock below zero is rejected unless it is a flagged adjustment, and a function lists flagged adjustments for reports
- [ ] Property test, invariant 5 (cost): replaying the same movements in the same order gives the same average cost
- [ ] Property test: while stock stays positive, the average stays between the lowest and highest received unit costs
- [ ] Latest purchase price per product, a separate function for recipe costing (spec: "Recipe costing")

## Notes

Depends on "Money and unit costs as bigint fixed-point" and "Movements and stock on hand". Where the average is rounded (each recalculation, to 6 places) is a rounding point to document in the code and in decision 0015.

Name each invariant's property test `invariant N: …`. Before writing property tests, list each property as one plain sentence in the plan for the repo owner to check.

Spec: `docs/spec.md` section 4, "Costing: weighted average". Decision 0005. Rules: `.claude/rules/ledger.md`. Workflow: see "How a session works" in `CLAUDE.md`.
