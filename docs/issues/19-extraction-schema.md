# Extraction result schema

## Why

One contract for what extraction returns. The LLM is asked for it, the validation checks and the eval compare against it, and the API will later store it. It lives in `packages/shared` so `extract`, `api` and `web` all use the same definition.

## Done when

- [ ] An `ExtractedDocument` Zod schema in `packages/shared`, mirroring spec section 3's Document and DocumentLine:
  - **Header:** document type (delivery note or invoice), supplier name, supplier tax ID, document number, issue date (ISO), currency (EUR only for now).
  - **Totals:** net amount, VAT per rate (base, rate, amount), total.
  - **Lines:** supplier code, description, quantity, unit as printed, unit price, discount percentage, VAT rate, line total.
- [ ] Every amount, quantity and percentage is a decimal **string**, never a JavaScript `number`, with at most the decimals decision 0015 allows: money 2, unit prices and quantities 6, percentages 2. Negative values are allowed for returns and credit notes.
- [ ] A JSON Schema generated from the Zod schema (Zod 4's `z.toJSONSchema`), for models that support structured output. A test fails if the generated JSON Schema changes without the snapshot being updated on purpose.
- [ ] Example tests:
  - a hand-written delivery note and a hand-written invoice parse;
  - each kind of invalid input is rejected with a path to the bad field: a number instead of a string, three decimals on money, a missing line field, an unknown document type.

## Notes

The plan should decide which fields may be `null` ("not printed or unreadable") instead of required. Lean towards nullable for anything a real document may omit (supplier code, discount, document number on some delivery notes), so the model never has to invent a value. A missing value then fails a validation check and goes to review, instead of being guessed.

No model-confidence field in v1: a model's own confidence score isn't reliable enough to decide review on (spec section 5, stage 6). The validation checks decide instead.

Spec: `docs/spec.md` sections 3 and 5. Rules: `.claude/rules/extract.md`. Workflow: see "How a session works" in `CLAUDE.md`.
