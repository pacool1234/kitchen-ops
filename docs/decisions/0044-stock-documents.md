# 0044. Stock documents: waste, counts and transfers, recorded under the client's ID

- Status: Accepted
- Date: 2026-10-21
- Updated: 2026-10-21, by #149's second PR: counts, recorded as point 3 says. A count's lines may be 0, and name each product once. Its `counted_at` is measured against the movements stamped by then, which are stamped once the posting lock is taken; it may be up to 5 minutes ahead of the database's clock, a phone's running fast, and any time before.
- Updated: 2026-10-22, by #151's first PR: point 7. Each is read on its own, as recording one answers, and with unit costs for office and the owner only.

## Context

Spec section 3 lists counts, waste and transfers as documents, next to delivery notes and invoices. The ledger posts all three (#32, #148). Until now the API knew only supplier documents: read from a file, reviewed, and posted from review. The documents table required a supplier on every posted document and a price on every line.

M8 records these on phones (spec 11.1), sometimes offline (#153). A phone that sent a count and never heard the answer must be able to send it again without posting it twice: "syncs exactly once, even if sent twice" (spec 11.4).

## Decision

1. **They are documents, in `documents`, with types of their own:** `waste`, `count` and `transfer`. Their lines and movements are stored as a delivery note's are, so posting, reversing and the audit log work as they do. They have no files, no draft, no review and no supplier.
2. **Each is recorded and posted in one step,** in one audited transaction under the posting lock. There's nothing to review: what's typed is what happened.
3. **The client makes the ID: `PUT /api/waste/:id`, `/api/transfers/:id`, and `/api/counts/:id` (#149's second PR).**
   - The first request records and posts the document.
   - The same request again answers what was posted, and posts nothing more.
   - Another request under the same ID is refused with 409 `conflict`. So is a supplier document's ID.
   - "The same request" is the sha256 of the parsed body, kept in `request_sha256`.
   - Both answers are 200: either way, the document is there, as asked.
4. **Their own columns,** each checked to its type:
   - `storeroom_id`: where waste or a count was, or a transfer's source;
   - `to_storeroom_id`: a transfer's destination, never its source;
   - `waste_reason` and `note`: why waste was thrown away, from a fixed list (`expired`, `spoiled`, `broken`, `prep_error`, `other`), so reports can group it, and a few words more;
   - `counted_at`: when a count was made (#153).
5. **A stock document's line has no price** (`unit_price` is null). Its movements carry the cost, at the average. A 0 would read as "free".
6. **Who:** every role records waste and counts (spec section 6), and transfers too, since bar staff take drinks from the dry store (spec 11.1). Reversing is the owner's, as for any posted document. A stock document has no corrected copy: there are no files to review again, so a mistake is reversed and recorded again.
7. **They stay out of Documentos,** which lists supplier documents, and have no page there. They show in a product's movements (#150) and on pages of their own (#151, #152).
   - Each is read with `GET /api/stock-documents/:id` (#151): what was recorded, where, why, by whom and when, each line with its movements, and its reversal's.
   - Recording one answers the same, so a phone shows what it posted without asking again.
   - Unit costs are for office and the owner only (spec section 6), as on the stock list (#150). A counter user's answer has no `unitCost`.
   - `GET /api/documents/:id/posting` reads supplier documents only, since it would give anyone the costs. The owner's `POST /api/documents/:id/reverse` still answers a reversed stock document's posting, costs included.

## Alternatives considered

- **Tables of their own for each kind.** Reversal, the audit log and the posted page would each be built again, for documents that post exactly like the others.
- **`POST` with an `Idempotency-Key` header.** A second key store, and a retry with a new key would post twice. With the document's own ID in the path, a retry can't create another one.
- **Comparing a repeated request with the stored lines,** rather than a hash. Lines are stored in the ledger's form, with units converted and IDs given; a body can't be compared with them directly.
- **A review step, as for supplier documents.** Nothing was read by a model, so there's nothing to check against an original; counter staff would wait for the office to post what they counted.
