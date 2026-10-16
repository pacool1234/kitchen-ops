# Gold set of 20–30 documents

## Why

M3 needs 20–30 gold documents (spec section 9): enough variety for the metrics to mean something, and few enough to check every answer by hand.

## Done when

- [ ] 20 to 30 gold documents in `eval/gold/`, in the format from "Gold set: format, checks and the first synthetic documents", including:
  - at least 10 text PDFs;
  - at least 5 photos or scans;
  - at least 3 Facturae XML files;
  - at least 2 multi-page documents;
  - at least 1 credit note.
- [ ] Every answer has been checked by the repo owner and recorded in its `meta.json`.
- [ ] The gold set test also fails if there are fewer than 20 or more than 30 documents, or if any answer is unchecked.
- [ ] `eval/gold/README.md` lists each document with its origin, kind and what makes it hard.

## Notes

The repo owner leads this one. Claude can render synthetic PDFs and draft `expected.json` files from a written description, for the owner to check. Photos come from printing and photographing synthetic PDFs. Public Facturae examples need a licence that allows committing them; otherwise synthetic ones.

Nothing from the private eval folder, ever (spec section 8).

Depends on "Gold set: format, checks and the first synthetic documents". Can run alongside the other M3 issues.

Spec: `docs/spec.md` sections 5, 8 and 9. Rules: `.claude/rules/extract.md`. Workflow: see "How a session works" in `CLAUDE.md`.
