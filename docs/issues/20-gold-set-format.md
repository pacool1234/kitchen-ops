# Gold set: format, checks and the first synthetic documents

## Why

The eval is only as good as its answers. Each gold document needs an expected result that a person has written or checked, in a format a test can verify.

## Done when

- [ ] Each gold document is a folder `eval/gold/<id>/` with:
  - `source.<pdf|jpg|png|xml>`: the document itself;
  - `expected.json`: the expected `ExtractedDocument` (from "Extraction result schema");
  - `meta.json`: where it comes from (`own`, `public` or `synthetic`), what kind of input it is (`text-pdf`, `scan`, `photo` or `facturae-xml`), short notes on what makes it hard, and who checked the answer and when.
- [ ] A test in `packages/extract` that fails if:
  - an `expected.json` doesn't validate against the schema;
  - a folder doesn't have exactly one source file and one `meta.json`;
  - a `meta.json` has an unknown origin or kind, or no `checkedBy`.
- [ ] A script that renders a synthetic delivery note or invoice as a PDF from a hand-written `expected.json`, so the document matches its answer by construction. Suppliers are fictional, with tax IDs that pass the checksum but belong to no real company.
- [ ] The first 5 synthetic documents, chosen to be different from each other:
  - a delivery note without prices;
  - an invoice with line discounts and two VAT rates;
  - a multi-page invoice;
  - lines in boxes, kg and units;
  - a credit note with negative lines.
- [ ] The repo owner has checked each `expected.json` against its source and recorded it in `meta.json`.

## Notes

`.claude/rules/extract.md`:
- gold answers are written or checked by a person, never copied from model output;
- only own, public or synthetic documents are committed;
- client documents stay in the private eval folder and never come here.

Realistic photos and scans can come from printing a synthetic PDF and photographing it: a crumpled page, bad light, an angle. The answer stays the same and is still right. That part is the repo owner's.

Depends on "Extraction result schema".

Spec: `docs/spec.md` sections 5 and 8. Rules: `.claude/rules/extract.md`. Workflow: see "How a session works" in `CLAUDE.md`.
