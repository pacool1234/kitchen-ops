# 0035. Matching a document's supplier and lines: worked out when asked, remembered as supplier products

- Status: Accepted
- Date: 2026-10-20

## Context

Before a document can be posted, its supplier must be one of ours and each line must point to one of our products (#117). Spec section 5, stage 5 (Decided): the supplier by tax ID; lines by supplier code, then exact description, then a model's suggestion. A person confirms each new mapping once, and it's remembered. Spec 11.1 adds that a new supplier's first documents always go to review.

M6's reading job already finds the supplier by its normalised tax ID. Reviewing (#118) can change the supplier, create one on the spot, or correct a line's code and description, so a match found once can stop being right.

## Decision

1. **Matches are worked out each time they're asked for,** from the document's supplier, its draft and the catalogue as they are then. They aren't stored: a stored match would be one more copy to keep in step with the supplier, the draft and the catalogue. (A model's suggestion costs money, so it will be stored when it's added.)
2. **A line matches, in the spec's order:**
   - **by code:** its supplier code, trimmed, is exactly the code of one of the supplier's supplier products;
   - **otherwise by description:** its description is that of exactly one of them. "Exact" ignores case and runs of spaces, not accents: a model sometimes reads "TOMATE PERA" where it read "Tomate pera" before. When two supplier products share the description (two packs of the same thing), the line matches neither, and a person decides;
   - **otherwise nothing.**

   Only active supplier products of active products are used.
3. **A confirmed mapping is a supplier product,** made from the line's code and description, the product and the pack the person chose, for the document's supplier. It's audited with the document it came from. It's refused when it couldn't be remembered without ambiguity:
   - the code is already one of the supplier's (409 `code: taken`, as in the catalogue);
   - the line has no code, and its description already belongs to one of the supplier's active supplier products (409 `description: taken`).

   Either way the line already matches, or it's one a person has to decide each time (two packs under one description), or the catalogue needs changing (an inactive supplier product with that code). So once a mapping is confirmed, the same line on the supplier's next document matches it.
4. **A supplier product's code becomes optional.** Many delivery notes print no codes, and their lines could otherwise never be remembered. `SupplierProduct` (spec section 3, Decided) keeps every field it had; only the code may now be empty. A code, when there is one, stays unique per supplier.
5. **A supplier is new until it has 3 posted documents,** not counting reversals or documents reversed. Three covers a first delivery note, its invoice and one more. It's one constant (`NEW_SUPPLIER_DOCUMENTS`).
6. **Why a document needs review is answered with the matching,** as reasons: `no_draft`, `failed_checks`, `no_supplier`, `new_supplier`, `unmapped_lines`. Every read document waits for review today, and nothing posts itself. Who may post a document with or without reasons is for #118 and #119 to decide.
7. **Who:** everyone signed in reads the matching, as they read documents. Setting a document's supplier and confirming a mapping are for office and owner (spec section 6, "confirm supplier-to-product mappings"), only while the document is ready for review.

## Alternatives considered

- **Storing each line's match when the document is read:** quick to show, but stale once the supplier, a line or the catalogue changes.
- **A code-less line's description used as its code:** no schema change, but codes would no longer be what the supplier prints.
- **Matching descriptions ignoring accents too,** as the catalogue's search does: "Limón" and "Limon" are different text as printed, and a person confirming once is cheap.
- **5 documents before a supplier isn't new:** more review for every new supplier, for little more certainty.
