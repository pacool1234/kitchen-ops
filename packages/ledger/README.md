# @kitchen-ops/ledger

The stock ledger: pure TypeScript domain logic for movements, unit conversions, documents, weighted-average cost, yields and variance. The rules are in `docs/spec.md` section 4; this package implements them.

- **Pure.** No I/O of any kind: no database, files, network, clock or randomness. IDs and dates are passed in. The API stores what these functions return.
- **Zero runtime dependencies.** Lint enforces it, and also keeps Node built-ins and globals out of the library code. Tests may use dev tooling.
- **Never mutates.** Every function returns new values; movements and posted documents are never changed (invariants 3 and 7).

## Modules

| File | What it does |
| --- | --- |
| `quantity.ts` | `Quantity`: whole base units (g, ml or thousandths of a unit) as safe integers (decision 0010) |
| `money.ts`, `fixed-point.ts` | `Money` (bigint cents) and `UnitCost` (bigint millionths), line totals, `percentageOf` (VAT), and `roundDiv`, the one rounding function (decision 0015) |
| `conversion.ts` | Purchase units to base units, per product: 1.5 boxes of 6000 g is 9000 g |
| `movement.ts` | Movements, stock on hand, cached balances, reversals, and `appendMovements`, which allows negative stock only through a flagged adjustment |
| `cost.ts` | Received unit cost, weighted-average cost by replaying movements, and the latest purchase price for recipe costing. A correcting receipt counts in the place of the receipt it corrects |
| `valuation.ts` | A stock's value (on hand × average cost, in cents), and every product's stock, cost and value in each storeroom, with each storeroom's total and the grand total (decision 0043) |
| `document.ts` | Posting delivery notes, invoices, waste, counts and transfers into movements, all or nothing; reversing posted documents. An invoice corrects its delivery notes' prices (decision 0032). A count is measured against the stock when it was counted, so one synced late doesn't swallow what was posted since (decision 0043) |
| `invoice.ts` | Suggesting which delivery-note line each invoice line bills (decision 0032) |
| `recipe.ts` | Recipes, yields (net ÷ yield) and theoretical use from dishes sold |
| `variance.ts` | Actual use, unexplained variance and its value, and the report sorted by largest loss |

Every rounding point is listed in decision 0015 (`docs/decisions/0015-money-as-bigint.md`), with the function that does it, plus a stock's value (`stockValue`), added by decision 0043.

## Invariants and the property tests that cover them

The seven invariants from spec section 4. Each has at least one fast-check property test named `invariant N: …`, which states the property in plain words. `src/invariants.test.ts` fails if any invariant has no such test, if one of them doesn't call `fc.assert`, or if this list and the tests disagree.

### 1. Stock on hand is the sum of movements; a cached balance is rebuildable from them and checked against them

A balance kept up to date one movement at a time always matches adding everything up from scratch, and the check finds any cached figure that doesn't.

- `invariant 1: applying movements one at a time to a running balance always gives the same stock as adding them all up from scratch` (`movement.test.ts`)
- `invariant 1: a cached balance that matches the movements reports no mismatch, and changing one cached figure reports exactly that product and storeroom` (`movement.test.ts`)

### 2. Every movement references a posted document line

Posting and reversing only produce movements that point to a line of the posted document they return.

- `invariant 2: every movement from posting or reversing points to a line of the posted document returned with it` (`document.test.ts`)
- `invariant 2: every movement from posting or reversing an invoice points to a line of the invoice returned with it` (`invoice.test.ts`)

### 3. Movements are never updated or deleted; a correction is a reversing movement plus a new one

A reversal cancels its movement exactly, for stock and for cost, and creating one changes nothing that exists.

- `invariant 3: a movement and its reversal together leave stock exactly as it was without either` (`movement.test.ts`)
- `invariant 3: reversing a movement never changes the original or the existing list` (`movement.test.ts`)
- `invariant 3 (cost): a movement and its reversal together leave the average exactly as if neither had been posted` (`cost.test.ts`)
- `invariant 3: an invoice changes no movement; it only reverses existing receipts and posts new ones, each correction paired with the reversal of the receipt it corrects` (`invoice.test.ts`)

### 4. Posting is atomic: a document posts all its movements or none

One bad line anywhere stops the whole document, and a document that posts has every line's movements.

- `invariant 4: if any line fails, posting returns an error naming every failing line and no movements; one broken line anywhere in a document is enough` (`document.test.ts`)
- `invariant 4: if posting succeeds, every line produced its movements: one per line, two per transfer line, matching the line's quantity` (`document.test.ts`)
- `invariant 4: an invoice with any failing line posts no movements and names every failing line; one line billing an unknown delivery-note line anywhere is enough` (`invoice.test.ts`)

### 5. Replaying the same movements in the same order always gives the same stock and cost

The results depend only on the movements and their order: no hidden state, no clock, no randomness.

- `invariant 5: replaying the same movements in the same order gives the same stock for every product and storeroom, also from a fresh copy` (`movement.test.ts`)
- `invariant 5 (cost): replaying the same movements in the same order gives the same average cost for every product and storeroom, also from a fresh copy` (`cost.test.ts`)
- `invariant 5 (cost): with invoice corrections among them, replaying the same movements in the same order gives the same average costs and latest purchase prices, also from a fresh copy` (`invoice.test.ts`)
- `invariant 5: posting the same late count against the same movements gives the same movements, stock and costs, also from a fresh copy` (`document.test.ts`)

### 6. Negative stock is only possible through a flagged adjustment, which reports surface

Stock can only go below zero through a movement flagged as an adjustment, and reports can list those.

- `invariant 6: whatever is appended, stock only goes below zero, or further below, through a flagged adjustment` (`movement.test.ts`)
- `invariant 6: when appendMovements rejects, nothing is added and the existing list is unchanged` (`movement.test.ts`)
- `invariant 6: flaggedAdjustments lists exactly the flagged movements, in order` (`movement.test.ts`)
- `invariant 6: a late count takes stock below zero only as a flagged adjustment, and is flagged only when it does` (`document.test.ts`)

### 7. Posted documents are immutable; changing one means reversing it and posting a corrected version

Posting and reversing never change the documents or movements they are given, and a posted document can't be posted again.

- `invariant 7: posting never changes the document it was given, and a posted document can't be posted again` (`document.test.ts`)
- `invariant 7: reversing never changes the posted document or the existing movements` (`document.test.ts`)
- `invariant 7: posting or reversing an invoice never changes the invoice or the movements given` (`invoice.test.ts`)

## Commands

From the repository root:

- Tests: `pnpm --filter @kitchen-ops/ledger test`
- Coverage: `pnpm --filter @kitchen-ops/ledger test:coverage` (text summary, plus an HTML report in `coverage/`)
- Typecheck: `pnpm --filter @kitchen-ops/ledger typecheck`

## Testing rules

From `.claude/rules/ledger.md`:
- The test comes before the implementation.
- Each invariant has a fast-check property, stated first as one plain sentence.
- Each formula has an example with hand-computed numbers in the test name or a comment.
- A failing property is a finding: report the shrunk counterexample, never weaken the property to make it pass.
