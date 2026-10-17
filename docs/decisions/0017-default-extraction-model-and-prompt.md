# 0017. Default extraction model and prompt: GPT-6 Luna, prompt v1

- Status: Accepted
- Date: 2026-10-18

## Context

The first model comparison (#52) ran prompt v1 over the 20 gold documents with two cheap models and one frontier model (decision 0007). Three documents are Facturae and need no model, so each model made 17 calls. Results are in `eval/results/2026-10-18-*`.

| Model | Silent errors | Review | Correct | Cost | Latency p50 / p95 |
| --- | --- | --- | --- | --- | --- |
| `openai/gpt-6-luna` | 0 of 20 | 1 of 20 | 19 | $0.018 | 7.2 s / 24.7 s |
| `google/gemini-3.8-flash` | 1 of 20 | 0 of 20 | 19 | $0.207 | 11.8 s / 43.9 s |
| `anthropic/claude-opus-5.5` | 0 of 20 | 0 of 20 | 20 | $1.010 | 9.6 s / 35.6 s |

- Luna's one review was a three-page scan with a blank first page: it lost a line and misread a quantity, and the line-total check sent it to a person.
- Gemini's silent error was on the same scan. It read the trade name from the logo instead of the legal name printed with the NIF. "The supplier's name, as printed" allows both, so this is an ambiguity in prompt v1 rather than a plain misreading; a follow-up issue clarifies it.
- Opus runs with the schema in the prompt. Anthropic refuses structured output for a schema with more than 16 nullable fields, and ours has 18 (`config/models.json` records why).

The budget (spec section 7) is €30 a month for everything. After hosting, about €10 is left for OpenRouter: around 200 documents a month at Opus's price, but thousands at Luna's.

## Decision

The pipeline's default is **`openai/gpt-6-luna` with prompt `v1`**, using structured output.

- It made no silent errors, the same as Opus. Its one mistake was caught by validation, which is the failure the pipeline is designed for.
- It costs about $0.001 per document: 12 times less than Gemini and 55 times less than Opus. It was also the fastest.
- Opus stays in every eval run as the accuracy ceiling (decision 0007).

**This decision is provisional.** Twenty clean synthetic documents can't show that the silent error rate is below the 1% target. With 0 errors in 20 documents, the true rate could still be as high as about 14% (95% confidence). It is revisited:
- when the private set of client documents is run;
- when the gold set grows, or a new prompt version is tried;
- if Luna's review rate on client documents passes the 20% target.

## Alternatives considered

- **Opus as the default:** perfect on this set, but 55 times the cost. That would use most of the OpenRouter budget at a restaurant's volume, for no difference here that validation didn't already catch.
- **Gemini 3.8 Flash:** 12 times Luna's cost, slower, and the only model with a silent error.
- **Sending only documents that go to review on to Opus:** may be worth it once client documents show what Luna gets wrong. Not needed on this evidence.
