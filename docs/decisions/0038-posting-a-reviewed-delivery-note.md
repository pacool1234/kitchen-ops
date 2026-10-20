# 0038. Posting a reviewed delivery note: who posts it, at what pack and price, and a corrected copy after reversing

- Status: Accepted
- Date: 2026-10-20

## Context

M7's main "done when" (spec 11.4): a delivery note goes from photo to stock with no data typed except corrections (#119). #116 stores what `packages/ledger` posts; #117 and #118 find each line's supplier product and let a person correct the draft. Turning a reviewed draft into posted lines leaves five questions:

- **Who may post one.** Spec section 6 (Hypothesis) has every role "receive a delivery (photo, confirm quantities)", and office and owner "review and post supplier invoices" and confirm mappings. Spec 11.1 sends a new supplier's first documents to review always.
- **How a line's pack reaches the ledger.** A supplier prints "1,5 caja"; its supplier product says a caja holds 6 kg (decision 0026). The ledger converts a line with the product's own conversions, and "caja" may not be one of them, or may hold something else.
- **A line with no price.** The checks don't require prices on a delivery note, and many show none.
- **Changing a posted document.** Invariant 7: reverse it and post a corrected version. The reversed document can't change, and its files can't be uploaded again (a file's hash is unique).
- **Invoices,** which correct delivery notes' prices (decision 0032), are #120's.

## Decision

1. **Who posts a delivery note** (`mayPost`, `packages/shared`):
   - nobody, while anything is left before posting it but a new supplier: no draft, no supplier, failed checks, or a line without a supplier product (409 `review_pending`);
   - a counter user, when nothing at all is left: a known supplier, every line matched by code or description, every check passed;
   - office and owner, also when the supplier is new: they are the review a new supplier's documents go to.

   A counter user refused only for a new supplier gets 403 `forbidden`.
2. **A line is received at the pack of the supplier product it matched.** It keeps its quantity and unit as printed, and the ledger gets a conversion for that supplier product alone: one of the line's unit is the pack's base units. The price stays per printed unit, so the line total is exactly what the checks computed; nothing is divided and rounded before the received unit cost (decision 0015). The stored line remembers its supplier product (`document_lines.supplier_product_id`).
3. **A line with no price is received at €0,** and the invoice corrects it (decision 0032, "a note with no prices at all"). Until then, the product's average cost counts it at nothing.
4. **Each line goes to the storeroom chosen for it when posting, otherwise to its product's default** (decision 0033). A line with neither is refused on its line, and nothing is posted.
5. **Posting works out the document's matching again inside its transaction,** after the posting lock and with the document's row locked. What's posted is the draft and the matches as they stand at that moment, not as the screen last saw them.
6. **A line the ledger refuses is refused on its quantity:** `below_zero` for a return that would take stock below zero (invariant 6). Everything else about a line is checked before the ledger is called.
7. **Reversing is the owner's** (spec section 6), dated the day it's done. A delivery note isn't reversed while an invoice that stands bills its lines (409 `billed`, from decision 0032): that invoice is reversed first.
8. **A corrected copy, after reversing, is a separate owner's action:** "correct and post again". It's a new document in review, `copy_of` the reversed one, with its draft as read, its correction as posted, and its supplier. It shows the files of the document first uploaded. There's at most one copy per document (a unique index). Reversing doesn't make one by itself: a document posted by mistake shouldn't be posted again.
9. **The duplicate check ignores a reversed document, and its reversal:** a corrected copy has the same number.
10. **Invoices aren't posted yet:** 409 `not_a_delivery_note` until #120.

## Alternatives considered

- **Office and owner post everything; counter users never post.** Simpler, but it leaves out the counter's part in receiving a delivery, for documents with nothing left to decide.
- **A line restated in the pack's unit:** 1,5 caja of 6 kg as 9 kg at €12,00 ÷ 6 a kg. The price is divided and rounded before the received unit cost, so stock value and the checks' line total would disagree by cents.
- **A line with no price waits for one to be typed:** it breaks "nothing typed except corrections" for every supplier that doesn't price its delivery notes.
- **The last price this supplier charged, for a line with none:** closer to the truth until the invoice arrives, but it needs the price chain of each supplier product. A follow-up if €0 shows in reports.
- **Every reversal makes a corrected copy:** wrong for a document posted by mistake, which shouldn't come back to review.
- **A copy with its own file rows:** a file's hash is unique (#102), so the same files can't be stored twice.
