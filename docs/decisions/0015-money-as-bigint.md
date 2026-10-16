# 0015. Money and unit costs are bigint fixed-point

- Status: Accepted
- Date: 2026-10-16
- Changes: spec section 4, "Numeric representation" (**Decided**): unit costs in TypeScript were "a decimal library"; they are now `bigint` millionths.

## Context

The spec stores money totals as integer cents and unit costs with 6 decimal places (`numeric(18,6)` in Postgres), and never uses a JavaScript `number` for money. It named "a decimal library in TypeScript" for unit costs. The first ledger code that handles money (#29) needs that choice made.

## Decision

Both are a `bigint` counting the smallest unit, with a fixed number of decimals:

- **`Money`:** whole cents (2 decimals). €12.50 is `1250n`.
- **`UnitCost`:** millionths of a euro (6 decimals), per base unit (movements, average cost) or per purchase unit (a document line's unit price). €0.0185 per gram is `18500n`.

They are *branded* types: TypeScript treats them as different types, so a unit cost can't be passed where cents are expected. At the boundaries they travel as decimal strings (`"12.50"`, `"0.018500"`): `parseMoney`, `formatMoney`, `parseUnitCost` and `formatUnitCost` convert, and reject more decimals than the type holds instead of rounding.

**Rounding:** half away from zero (€0.005 → €0.01, −€0.005 → −€0.01), as on Spanish invoices, so our line totals match the printed ones. One function does it (`roundDiv` in `packages/ledger/src/fixed-point.ts`), only at these points:

| Point | Rounded to | Issue |
| --- | --- | --- |
| Line total: quantity × unit price − discount | cents | #29 |
| A percentage of an amount, e.g. VAT: base × rate (`percentageOf`) | cents | #46 |
| Received unit cost: line total ÷ quantity in base units (`receivedUnitCost`) | 6 decimals | #33 |
| Weighted-average cost, at each recalculation (`averageCost`) | 6 decimals | #33 |
| Gross quantity from a yield: net ÷ yield, per recipe line before multiplying by dishes sold (`grossQuantity`) | whole base units | #34 |
| Variance value: unexplained variance × average cost (`varianceValue`) | cents | #34 |

Document totals are sums of rounded line totals, so they need no rounding of their own. Line discounts are percentages with up to 2 decimals (the "Dto." column on Spanish delivery notes and invoices), applied before the line total is rounded. Recipe yields are percentages with up to 2 decimals too ("62.5"), above 0 and possibly above 100% for food that gains weight when cooked.

Quantities stay safe-integer numbers (decision 0010).

## Alternatives considered

- **A decimal library (decimal.js, big.js, Dinero.js):** the ledger's only runtime dependency, with its own rounding settings to keep consistent, and values that can't be compared with `===`. Integer arithmetic on `bigint` is exact and has no settings.
- **Banker's rounding (ties to the even digit):** avoids a tiny upward bias over many roundings, but disagrees with supplier invoices, which would show up as one-cent differences when matching extracted documents (M3).
- **Plain `bigint` without brands:** simpler signatures, but cents and millionths would mix silently.

The cost of `bigint`, as decision 0010 noted for quantities, is converting at every boundary: it isn't valid JSON. For money that conversion is needed anyway. Postgres `numeric` already arrives in Node as a string, and JSON numbers can't carry exact decimals either.
