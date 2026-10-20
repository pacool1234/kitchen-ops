# 0032. Invoices correct delivery-note prices with a correcting receipt, counted in its place

- Status: Accepted
- Date: 2026-10-20

## Context

Most suppliers bring a delivery note with the goods and invoice later, per delivery or monthly. A few send only an invoice (spec 11.1). Delivery notes create the receipts. An invoice's price can differ from its delivery note's: a price change the note didn't show, a discount agreed afterwards, or a note with no prices at all. M7 needs "an invoice corrects the prices of its delivery notes" (spec 11.4).

Spec section 4 constrains how:
- movements are never updated (invariant 3);
- a correction is a reversing movement plus a new one;
- "corrections are handled by replaying movements and recomputing".

The ledger already leaves a reversed movement and its reversal out of costs. Movements have no dates: costs replay them in list order. By the time an invoice arrives, some of the goods have usually been used.

## Decision

1. **An invoice is a document of its own** (`type: "invoice"`) from a supplier. Each of its lines may name the delivery-note line it bills.
2. **A line that bills a delivery-note line at a different unit cost posts two movements, both pointing to the invoice line** (invariant 2):
   - a **correcting receipt**, with the same product, storeroom and quantity, at the invoice's unit cost, marked `corrects` with the receipt it replaces;
   - the **reversal of that receipt**.

   The one that adds stock goes first, so stock never dips while the invoice posts, even when the goods were already used. Stock on hand doesn't change.
3. **Costs count a correcting receipt where the receipt it corrects was** in the list, not at the end. The average cost and the latest purchase price then come out exactly as if the delivery note had shown the invoice's price in the first place, however much was used in between.
4. **The same unit cost posts nothing.** The invoice is posted, with no movements.
5. **The quantity must match.** A line that bills a different quantity in base units than the delivery note received fails, and so does a line for another product. Stock follows what arrived. A disagreement is for the review screen (#120), not for stock.
6. **A line that bills no delivery-note line** is received exactly like a delivery-note line: an invoice-only supplier's invoice creates receipts itself (spec 11.1). A negative line is a return, as on a delivery note.
7. **An invoice covering several delivery notes:** each of its lines corrects its own delivery-note line. One delivery-note line billed twice in the same invoice fails. Posting is all or nothing (invariant 4).
8. **A rectifying invoice (factura rectificativa)** restates lines at their corrected price, billing the same delivery-note lines again. It corrects the correction: each line keeps a chain, and the last one in it is the price that counts.
9. **Reversing:**
   - **an invoice** puts back, for each line it corrected, the price that line replaced: a correcting receipt at that price, and the reversal of the receipt that stands for the goods now. Costs return to what they were before the invoice;
   - **a delivery note** takes its goods out as they stand now, at an invoice's price if one corrected them.

   Nothing is updated in either case.
10. **Matching help:** a pure function suggests which delivery-note line each invoice line bills. It suggests a pair only when it's the only candidate on both sides: same supplier, same product, same quantity in base units. Anything else is left for a person (#120).

## What stays open

- **A lump-sum credit with no product** ("€5 discount") isn't a line the ledger can post. The review screen (#120) decides whether to spread it over lines.
- **A credit note that states a price difference as a quantity** ("−10 kg at €0.20") would read as a return. The review turns it into a restated price.
- **A delivery-note line billed in parts** across two invoices fails the quantity check.
- **Goods transferred before the invoice** keep the cost the transfer carried in the storeroom they went to. Only the storeroom that received them is corrected.
- **Duplicates:** an invoice entered twice bills the same lines twice. Catching that is the API's job (#120).
- **Reversal order:** the ledger doesn't see which documents are reversed, and a live invoice's correction looks the same as the one that reversing an invoice posts. So the API, which knows, refuses to reverse a delivery note or an invoice while a later posted invoice bills the same lines (#119, #120). In the ledger, reversing the earlier one would quietly drop the later invoice's price.

## Alternatives considered

- **Reverse the delivery note and post a corrected copy at the end.** This is the existing correction path. It fails when the goods were already used, unless the copy goes first. Even then, the average replays the copy at the end, so it no longer matches "as if the price had been right".
- **A cost-only movement:** quantity 0 and a value, spread over the stock left. It's simpler, but the cost of goods already used has nowhere to go. It's also the only movement whose value wouldn't be quantity × unit cost.
- **Movements dated and replayed by date.** That would move the problem to every report, and the ledger deliberately doesn't read dates.
