# 0031. Gemini at the provider's temperature, and gold runs routed like client documents

- Status: Accepted
- Date: 2026-10-20
- Supersedes: the temperature in 0018's point 2. Gemini 3.8 Flash and prompt v2 stay the default.

## Context

The first document staging read for real (#105) failed with `model_error`, OpenRouter answering 404 "No endpoints found that can handle the requested parameters" on all three tries. Nothing reached a model, so it cost nothing and OpenRouter's activity page showed nothing.

A client document's call asks OpenRouter for three things at once (decision 0007, spec section 5):
- only zero-retention endpoints that collect no data;
- only endpoints that take every parameter sent (`require_parameters`), so the reply follows the schema;
- temperature 0 (decision 0018).

OpenRouter's endpoints for `google/gemini-3.8-flash`, on 2026-10-20:

| Provider | Zero retention | Takes `temperature` |
| --- | --- | --- |
| Google AI Studio | no | yes |
| Google Vertex (`global`, `us`, …) | yes | no |

No endpoint is left. A test prompt with the staging key confirmed it: the API's request answered 404; without the temperature, 200 from Google Vertex; with the temperature and without zero retention, 200 from AI Studio.

The eval never met this: the gold set was sent without restrictions, so 0018's runs went to AI Studio, an endpoint client documents can never use.

## Decision

1. **Gemini sets no temperature** (`config/models.json`): Vertex uses its own default.
2. **Gold runs are routed like client documents.** The documents are synthetic, so the stricter routing costs nothing (spec section 5 allows own and public samples to go unrestricted, and doesn't require it). Every eval run now measures the endpoints staging and production can reach.
3. **The rule agreed before the runs:** Gemini at the provider's temperature stays the default if, over three gold runs, it has 0 silent errors and at least 57 of 60 correct. 0018 measured a model at its default temperature varying by up to one document of 20 sent to review between runs.

Gold runs, prompt v2, results in `eval/results/2026-10-20-*`:

| Model | Temperature | Endpoint | Runs | Silent errors | Review | Correct | Cost per document with a model call |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `google/gemini-3.8-flash` | 0 (0018) | AI Studio | 3 | 0 of 60 | 0 of 60 | 60 of 60 | $0.0107 |
| `google/gemini-3.8-flash` | provider's | Vertex | 3 | 0 of 60 | 0 of 60 | 60 of 60 | $0.0128 |

- **The rule is met:** no silent errors, nothing sent to review, every document right in every run.
- **The three runs gave the same answer for every document,** as 0018's did at temperature 0. They still carry little more than one run (0018's "Still provisional" applies).
- **A document costs about 19% more:** $0.0128 against $0.0107. The answers are as long as before (about 2,560 output tokens a document against 2,610), but Vertex counts about 4,300 input tokens where AI Studio counted about 1,780, for the same files and prompt. At about 300 documents a month that's about $3.80 instead of $3.20, still within the budget (spec section 7).
- **Latency is about the same:** p50 12.6–13.9 s against 9.5–12.6 s, p95 32–46 s against 30–41 s.

## Alternatives considered

- **Drop the zero-retention rule for this model:** client documents would go to an endpoint that keeps data. Decision 0007 rules it out.
- **Drop `require_parameters`:** OpenRouter would then ignore the temperature, but also any endpoint's lack of structured output, and a reply might not follow the schema.
- **Temperature 0 for the eval only:** the eval would measure a setting production can't use.
