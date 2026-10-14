---
paths:
  - "packages/extract/**"
  - "eval/**"
---

# Extraction package and eval rules

Spec: `docs/spec.md` section 5.

## Data

- `eval/gold/` is committed: only own, public or synthetic documents, each with hand-written expected JSON. Never create gold answers by copying model output; they are written or checked by a person.
- `eval/private/` holds client documents. Do not open, list, quote or copy its contents. Eval runs against it are started by the repo owner, not by you.
- Never put document contents into commit messages, PR descriptions, logs or test snapshots.

## LLM calls

- All calls go through OpenRouter using `OPENROUTER_API_KEY` from the environment.
- Model IDs come from config, never hard-coded in pipeline logic.
- The provider-routing setting that excludes providers which train on or retain data must be applied in code for any run over `eval/private/`; make it impossible to forget (e.g. a required option when the private set is selected).
- Every LLM response is validated with the Zod schema from `packages/shared`. Invalid output: one retry, then route to review. Never "repair" output by guessing.

## Validation before trusting a result

- Line totals = quantity × unit price − discount; lines sum to the document total; VAT adds up.
- Spanish tax IDs (NIF/CIF) pass their checksum.
- Results that fail any check go to review, with the failing check named.

## Eval output

- One command runs a model/prompt combination over a set and writes `eval/results/<date>-<model>-<prompt>.json` plus a Markdown summary.
- Always report the silent error rate first (documents that passed validation but were wrong), then review rate, field accuracies, cost per document and latency.
- Network calls are not allowed in unit tests; mock the client. Real calls only in the eval command.
