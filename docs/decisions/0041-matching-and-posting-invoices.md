# 0041. Matching an invoice to its delivery notes, and posting it

- Status: Accepted
- Date: 2026-10-21

## Context

Decision 0032 settled how an invoice corrects its delivery notes' prices in the ledger: a line that bills a delivery-note line posts a correcting receipt and the reversal of the one it replaces, or nothing at the same price. Its `suggestBilledLines` pairs lines only when each is the other's only candidate. It left the rest to #120:
- which delivery notes an invoice is compared with, and who confirms the pairs;
- an invoice entered twice;
- credit notes that state a price difference;
- the order of reversals.

Decision 0040 has the draft list the delivery notes an invoice says it bills. Spec section 6 gives reviewing and posting invoices to office and the owner. Spec 11.1 has a few suppliers send only invoices.

## Decision

1. **The lines an invoice may bill** are its supplier's posted delivery notes that stand (not reversed, not reversals), and their lines whose goods are still received. A line a standing invoice already bills isn't one, except for a credit note (point 7). This catches an invoice entered twice.
2. **Suggestions come from fewer of them:**
   - the delivery notes the invoice lists, compared as document numbers are, if any match;
   - otherwise, those dated in the 62 days up to the invoice's date, which covers a monthly invoice.

   `suggestBilledLines` then pairs an invoice line with a delivery-note line of the same product and base quantity, when each is the other's only candidate. An invoice line's product is its own supplier product's, by code or description. A line with a negative quantity is never suggested: a return bills nothing.

   A person may still choose any line it may bill, older ones included.
3. **Office and the owner confirm each line:** the delivery-note line it bills, or "received with the invoice". `PUT /api/documents/:id/billing`, audited with the document.
   - Confirmed choices are stored (`invoice_line_bills`). Suggestions aren't, like product suggestions until they're confirmed.
   - A correction that adds or removes lines clears the choices, audited in the same save: line 3 could otherwise become line 2 and keep line 3's choice. A correction of values keeps them, and they're checked again.
4. **An invoice-only supplier,** one that has never posted a delivery note, has its lines received with the invoice unless someone says otherwise.
5. **What review shows, for a billed line:**
   - the delivery-note line's price now: the unit cost of the receipt that stands for its goods (`ledger.standingReceipt`), after any earlier invoice;
   - the invoice's: its line total over its base units;
   - the difference in euros: the invoice line's total, less the delivery-note line's base units at its price now, rounded once to the cent.

   The invoice's total difference is the lines' added up. An invoice's quantity is converted at its own supplier product's pack, or else at the delivery-note line's when it's printed in the same unit.
6. **Posting an invoice:**
   - **What's left first:** nothing may be, but a new supplier. The new reasons are a line only suggested or undecided (`unbilled_lines`), and a confirmed line whose base quantity isn't what its delivery note received (`quantity_differs`, decision 0032 point 5).
   - **On an invoice, products** are needed only for the lines received with it. A billed line is its delivery-note line's product.
   - **Who:** office and the owner (`mayPost` takes the type); a counter user never.
   - **Inside the posting lock,** the choices are checked again: a line another invoice billed since it was chosen is refused, 409 `already_billed`, on its field.
7. **A credit note** is an invoice whose total is negative.
   - A line with a negative quantity, received with it, is a return.
   - A line with a negative price that bills a delivery-note line is a price difference. It's posted as that line's price now, per printed unit, plus the difference, and the ledger chains it as a rectifying correction (decision 0032 point 8). Such a line may bill a line an invoice already bills; it can't have a discount of its own.
8. **An invoice isn't reversed** while a later invoice that stands bills the same lines (409 `billed`). The ledger would put back this one's price and quietly drop the later one's. A posted document never changes, so its `updated_at` is when it was posted, and that orders them. The later one is reversed first.

## Alternatives considered

- **Every unbilled delivery note of the supplier, for suggestions:** more ambiguous pairs, so fewer suggestions, for a monthly invoice among months of deliveries.
- **Storing suggestions:** a suggestion would go stale as delivery notes are posted or reversed; worked out each time, it never does.
- **Keeping choices by line through any correction:** removing line 2 would leave line 3's choice on what's now line 2.
- **A reversal guard on the receipt that stands:** refuses reversing an invoice once the credit note after it is reversed, though its price is the one standing again. Ordering by posting time is what matters.
- **Refusing a credit note's difference until someone types the new price:** the difference is what's printed; restating it on the price now is exact.
