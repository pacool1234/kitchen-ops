# 0034. Stored movements: append-only by trigger, in the order they were posted, one posting at a time

- Status: Accepted
- Date: 2026-10-20

## Context

M7 stores what `packages/ledger` produces (#116): the lines of a posted document and their movements. Spec section 4's invariants have to hold in the database, not only in the library:
- stock is the sum of movements;
- movements are never changed;
- posting is all or nothing;
- replaying the same movements in the same order gives the same results;
- posted documents can't change.

Movements have no dates in the ledger: their order is the order of the list. Weighted-average cost depends on that order, and so do invoice corrections, which count where the receipt they correct was (decision 0032).

## Decision

1. **A `movements` table**, one row per ledger movement:
   - product, storeroom;
   - quantity: whole base units, `bigint`;
   - unit cost: `numeric(18,6)`, written and read as text, never a JavaScript `number`;
   - kind, the document line it comes from;
   - `reverses` and `corrects`, each pointing to another movement, each under a **unique index**: the database itself refuses reversing or correcting a movement twice;
   - the adjustment flag.
2. **Order:** a `sequence` column numbered by the database (`generated always as identity`). Movements are always read back ordered by it, and that is the ledger's list order.
3. **One posting at a time.** Posting and reversing take a transaction-level advisory lock (`pg_advisory_xact_lock`) before reading anything. Without it, two postings could each check stock before the other wrote: stock below zero without a flag (invariant 6), or one document posted twice. The sequence then also matches commit order. A restaurant posts a few documents an hour, so the wait is never noticeable.
4. **A `document_lines` table, written when a document is posted:** the record of what was posted.
   - Fields: product, quantity and unit as printed, unit price, discount, VAT rate, storeroom (decision 0033), the delivery-note line an invoice line bills, and the adjustment flag.
   - Until then, the draft (JSON) holds what's being reviewed and corrected (#118). Editable line rows would mean keeping two copies in step, and no trigger could guard them.
5. **Append-only in the database itself**, with triggers like the audit log's (decision 0025):
   - `movements` and `document_lines` refuse every `UPDATE` and `DELETE`;
   - `documents` refuses changing or deleting a row once it's `posted` (invariant 7).

   `TRUNCATE` stays possible, for resetting test databases.
6. **A reversal is a document too,** as in the ledger: a new `posted` row with `reverses` set (unique), its copied lines and its movements. The posted row it reverses is never touched: "reversed" means another document reverses it. Reversals have no files, so the documents endpoints leave them out until #119 shows them.
7. **`posted` joins the document statuses.** M6's `ready_for_review` is the review status. A posted document has its type, supplier and date (a check constraint).
8. **The audit log gets one entry per posting** (the document's update to `posted`) **and one per reversal** (the reversing document's creation). Its lines and movements aren't logged one by one: they are themselves append-only records pointing to that document.
9. **No cached stock balances yet.** Stock is read from movements. A balances table, checked against them (invariant 1), fits better with M8's stock screens.

## Alternatives considered

- **Order by creation time or by ID:** both are set by the API before the row is written, so concurrent postings could interleave in either. The identity column, under the lock, can't.
- **Serializable transactions instead of a lock:** conflicting postings would fail and need retrying. The lock makes them wait instead, which is simpler to reason about at this volume.
- **Revoking `UPDATE` and `DELETE` from the app's database role:** on Render the app connects as the tables' owner, which can grant the rights back to itself. Decision 0025 already chose triggers for the same reason.
