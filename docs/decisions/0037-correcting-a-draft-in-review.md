# 0037. Correcting a draft in review: saved whole, apart from what was read, and checked again

- Status: Accepted
- Date: 2026-10-20

## Context

M7's review screen (#118) is where a document's draft is corrected before it's posted: any field of the header, any line, lines added or removed. The issue asks for corrections kept apart from what the model read, so both can be seen; for the checks to run again as fields change; and for who does what to follow spec section 6 (Hypothesis): every role "receives a delivery (photo, confirm quantities)", while office and owner "review and post supplier invoices" and confirm mappings.

The checks (spec section 5, stage 4) are in `packages/extract` and use the ledger's arithmetic, so a document that passes them is posted at the same amounts (decision 0016). The web app may depend only on `shared`, so it can't run them. The duplicate check also needs the numbers already received from the document's supplier, which only the database has.

## Decision

1. **A correction is saved whole, in its own column.** `documents.corrected` holds the corrected draft, in the same shape as `draft`. `draft` stays exactly what the model read. The draft as it stands is `corrected ?? draft`, and it's what everything after reading uses: the checks, matching, remembering a line, and posting (#119). The audit log records each save's before and after, so it already holds every version; a table of versions would repeat it.
2. **Saving runs the checks again,** as the reading job does, with the document's supplier's numbers, and stores their failures. A correction that fails a check is saved anyway: it may be half done, and posting is what refuses a document with failures (#119). Saving also sets the document's type, number and date from the corrected header, so the list shows them.
3. **A version can be checked without saving it:** `POST /api/documents/:id/draft/checks` answers the failures and writes nothing. The review screen calls it shortly after a field changes. Saving on every change instead would fill the audit log with half-typed values.
4. **The supplier:** one the document has, found when it was read or chosen in review, stays when a correction is saved. A document without one gets the supplier the corrected tax ID finds, if any. Choosing a supplier (decision 0035) runs the checks again, because the duplicate check depends on it.
5. **Who corrects what (spec section 6):** office and owner, anything. A counter user, only a delivery note's line quantities: the same lines, in the same order, everything else unchanged, compared as content. Anything else they send is refused with 403 and nothing is saved. Counter users can't correct invoices, or a document nothing was read of. The API enforces it; the screen will only offer what a role may change.
6. **A document the model couldn't read** (no draft) can be typed in by office or owner: a correction is a whole draft, so it needs no draft to start from.
7. **The last save wins.** Two people reviewing the same document at once is unlikely in one restaurant; a version check can be added if it happens.

## Alternatives considered

- **Overwriting `draft`:** loses what was read, which the issue asks to keep, and which shows how good reading is.
- **Storing only the fields changed:** every reader would have to merge them over the read draft, and lines added or removed make field paths shift.
- **Moving the checks to `shared`:** they'd need the ledger's arithmetic there, and the duplicate check would still need the database.
- **Counter users read-only for now:** simpler, but it leaves out spec section 6's "confirm quantities", the one correction a person receiving a delivery can make with the goods in front of them.
