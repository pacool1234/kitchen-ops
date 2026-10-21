# 0043. A stock's value, and a count as of when it was counted

- Status: Accepted
- Date: 2026-10-21
- Adds to: decision 0015's list of rounding points (a new one, below). 0015 is otherwise unchanged.

## Context

M8 (spec 11.4) shows stock on hand per product and storeroom, "valued at average cost", and counts made on phones that "work offline and sync exactly once". Two things in the ledger weren't settled:
- **A stock's value** is on hand × average cost: base units × millionths, which isn't a whole number of cents. Decision 0015 lists every point where the ledger rounds, and this wasn't one.
- **A count compared what was counted with the stock when it was posted.** There's no signal in the cold room (spec 11.1), so a count may reach the server hours after it was made. Counted at 10:00 and synced at 14:00, it would swallow a delivery posted at 12:00: the delivery's goods would vanish from stock.

## Decision

1. **A stock's value is on hand × average cost, rounded once to cents, half away from zero** (`stockValue`, through `roundDiv`), for each product in each storeroom. This is a new rounding point, next to decision 0015's.
2. **A storeroom's value is the sum of its products' rounded values, and the total is the sum of the storerooms'** (`valuation`). Totals need no rounding of their own, as with a document's lines, and the figures on screen add up.
3. **A count is measured against the stock as it was when it was counted.**
   - The ledger has no clock, so a count says how many of the movements posted so far were there when it was made (`movementsBeforeCount`). The API works that out from the time it was counted and the stored `sequence` (#149).
   - Its difference is counted − on hand then, valued at the average cost then.
   - The stock afterwards is what was counted, plus everything posted since.
   - A count that doesn't say is measured against all of them, as before.
4. **A late count that leaves stock below zero is posted as a flagged adjustment, by the ledger itself.** Counted 0 at 10:00, after 2 kg of waste posted at 11:00, stock ends at −2 kg: something posted since didn't match what was there. Invariant 6 holds, and reports surface it. A count made on time can't do this: its stock afterwards is what was counted.
5. **A late count doesn't rewrite averages.** Costs keep replaying in posting order. The count changes stock from when it's posted, and the receipts posted between the count and its sync keep the averages they had.

## Alternatives considered

- **Round once, at the total.** The total would then differ by a cent or more from the sum of the values shown above it.
- **Measure counts against the stock when they're posted.** Simple, and wrong for exactly the counts M8 has to get right: those made offline.
- **Refuse a late count that would leave stock below zero.** The count would be lost, though it's the most direct evidence of what was there. Flagging keeps it, and shows the mismatch.
- **Insert a late count at its place in the history, and replay costs around it.** Averages already used for postings would change after the fact. Invariant 3's way of correcting is a new movement, never a changed past.
- **A date on movements, for the ledger to compare.** Movements have no date on purpose (`movement.ts`): order is the list's. A position in the list says the same, with no clock in the ledger.
