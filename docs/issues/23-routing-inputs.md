# Routing: text PDFs, images and Facturae XML

## Why

Different inputs need different treatment (spec section 5, stage 2):
- structured e-invoices can be read exactly, without an LLM;
- text PDFs are cheaper and more reliable as text;
- photos and scans need a vision model.

## Done when

- [ ] The input's kind is detected from its content (file signature), not its file name: PDF, JPEG, PNG or XML.
- [ ] **Facturae XML** (version 3.2.x) is parsed directly into an `ExtractedDocument`, with no LLM call. It is tested with a synthetic Facturae file.
- [ ] **Text PDFs:**
  - their text is extracted and sent to the model as text;
  - a PDF with no usable text layer (a scan saved as PDF) is treated as an image.
- [ ] **Images** are sent to a vision-capable model, within a size limit the plan sets.
- [ ] A SHA-256 hash of the original is returned with every result, so duplicates can be caught (stage 1). Storing originals in object storage is API work and comes later.
- [ ] Tests cover each route with small synthetic fixtures; LLM calls are mocked.

## Notes

The plan should choose:
- the PDF text library;
- how image-only PDFs reach a vision model: send the PDF where the model accepts it, or render its pages to images.

UBL e-invoices, and HEIC photos from iPhones, can wait until a real document needs them.

Depends on "LLM extraction through OpenRouter".

Spec: `docs/spec.md` section 5. Rules: `.claude/rules/extract.md`. Workflow: see "How a session works" in `CLAUDE.md`.
