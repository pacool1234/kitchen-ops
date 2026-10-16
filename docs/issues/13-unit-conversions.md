# Unit conversions

## Why

Suppliers sell in boxes, kilos and bottles; stock is kept in grams, millilitres and thousandths of a unit. Every document line goes through a conversion before it can move stock.

## Done when

- [ ] `UnitConversion` type per spec section 3 (product, unit name, factor in base units), so the same unit name can mean different amounts for different products (a box of tomatoes is not a box of eggs)
- [ ] A function that converts a purchase quantity (a decimal string such as `"2.5"` kg) to whole base units; a result that isn't whole (0.0001 kg → 0.1 g) is rejected, never rounded silently
- [ ] Unknown unit for a product, and a factor that isn't a positive whole number, are rejected with clear errors
- [ ] Example tests with hand-computed numbers (1.5 boxes × 6000 g = 9000 g; 3 bottles × 750 ml = 2250 ml; 12 eggs = 12000 thousandths)
- [ ] Property tests: converting a and b separately and adding gives the same as converting a + b; converting from the base unit itself (factor 1) changes nothing

## Notes

Depends on "Money and unit costs as bigint fixed-point" (decimal parsing). Before writing property tests, list each property as one plain sentence in the plan for the repo owner to check.

Spec: `docs/spec.md` sections 3 and 4. Rules: `.claude/rules/ledger.md`. Workflow: see "How a session works" in `CLAUDE.md`.
