# 0040. Reading the delivery notes an invoice lists: a field of the draft, prompt v3, scored apart

- Status: Accepted. Prompt v3 becomes the default once its eval holds (below)
- Date: 2026-10-21

## Context

#120 matches an invoice to its supplier's posted delivery notes "by the numbers it lists, or else by date and lines". Nothing read those numbers: the draft (`ExtractedDocument`) had no field for them, and the Facturae reader skipped `DeliveryNotesReferences`. Two gold invoices print them: syn-007 ("según albarán A-2026/01142") and syn-013, which groups three. A credit note, syn-009, names the return note it credits.

Spec section 5 is Decided only on "a Zod schema (header + lines)". A header field changes no Decided item. The schema is part of what a model is given, though: its descriptions are instructions (decision 0018).

## Decision

1. **The draft lists the delivery notes it bills:** `deliveryNotes`, each number as printed, in the order printed; `[]` for none, and on a delivery note.
   - It's required, as every key is for strict structured output, with no default.
   - A Facturae file names them per line; the draft lists each once, in the order first seen.
   - A credit note's return note counts: it's the delivery note it credits.
2. **Prompt v3** is v2 with one rule about them, so runs with and without the field stay apart. It says to leave out order and customer numbers.
3. **The eval reports the field but doesn't score it.** It's compared like a document number, in any order. A wrong list is named as a difference, but the document can still be correct, and its silent error rate doesn't change. A missed number only leaves matching to fall back on dates and lines, which a person confirms (#120). Runs from before the field stay comparable.
4. **Every gold answer writes the list,** `[]` for none. The schema refuses one that doesn't.
5. **A draft saved before** has no list, and is read as listing none. That happens in the API's column type for stored drafts, `storedDraft`, as each row is read. A migration can't add the list: posted documents' rows can't be updated.
6. **v3 becomes the default** (`packages/extract/config/models.json`) once the repo owner's eval over the gold set shows a silent error rate and review rate no worse than v2's, over the same number of runs. Until then, the default stays v2. Its results are committed and linked here.

## Alternatives considered

- **No reading, only dates and lines:** cheaper, but a monthly invoice over several delivery notes of the same products is ambiguous by lines alone, and the number is printed right there.
- **A default of `[]` in the schema:** the response serializer encodes with the schema and refuses a transform, and a default isn't part of strict structured output.
- **Scoring the field:** one missed number would count a document as a silent error, though nothing wrong reaches stock, and v2's runs would no longer compare.
- **Keeping the prompt at v2:** the schema given to the model changes either way; a new version keeps results honest.
