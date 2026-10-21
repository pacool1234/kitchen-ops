# 0018. Default extraction model and prompt: Gemini 3.8 Flash, prompt v2, temperature 0

- Status: Accepted; its temperature 0 is superseded by 0031, and its prompt v2 by v3 in 0040
- Date: 2026-10-18
- Supersedes: 0017

## Context

Decision 0017 chose GPT-6 Luna with prompt v1 from one 20-document run per model. Then:
- prompt v2 (#63) added the rule on the supplier's legal name;
- the eval learned to repeat a run (#68).

Repeated runs over the 20 gold documents, all with today's schema. Results are in `eval/results/2026-10-18-*-run{2,3,4}.*`.

| Model | Prompt | Temperature | Runs | Silent errors | Review | Correct | Cost per document with a model call |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `openai/gpt-6-luna` | v1 | default | 3 | 3 of 60, 0–2 per run | 4 of 60, 1–2 per run | 53 of 60 | $0.0009 |
| `openai/gpt-6-luna` | v2 | default | 3 | 3 of 60, 0–2 per run | 4 of 60, 1–2 per run | 53 of 60 | $0.0010 |
| `google/gemini-3.8-flash` | v2 | 0 | 3 | 0 of 60 | 0 of 60 | 60 of 60 | $0.0107 |

- **v1 and v2 are equal for Luna,** and v2 got the supplier's legal name right in every run. Luna's 0 against 2 silent errors in #63 was within the variation between runs.
- **Luna misreads the same document every time.** On the sideways, shaded photo of an invoice (syn-015), it gets a unit wrong and reads a blank discount as "0" in all six runs. Validation caught it in only two of them: the totals still add up. It also misreads a VAT rate on another photo (syn-017) in two runs out of six, with no warning either time.
- **Gemini at temperature 0 read every document right, the same way, every time.**
- **Luna can't be run at temperature 0:** OpenRouter has no Luna endpoint that accepts the parameter (`config/models.json` records it).

## Decision

1. **The default prompt is v2.** The rule agreed before the runs: summed over three runs each, v2 is no worse than v1 on silent errors, review and correct documents, with cost and latency within 10%. It is equal on all three, costs 3% more and was faster.
2. **The default model is `google/gemini-3.8-flash`, at temperature 0.**
   - Luna's silent error rate, about 5% here, misses the 1% target (spec section 5) on documents a phone photo can easily produce.
   - Sending documents on to a better model only after a failed check wouldn't help: these errors pass validation.
   - Gemini costs about 11 times Luna's price, about $0.011 a document. The budget (spec section 7) leaves about €10 a month for OpenRouter, which covers around 1,000 documents.
3. **How big a difference counts as real.** A model at its default temperature varied by up to 2 documents of 20 between runs: silent errors 0–2, review 1–2, correct 17–18. A single-run difference no larger than that isn't treated as a real difference between prompts or models. Compare repeated runs instead.

**Still provisional.**
- Three runs of the same 20 documents measure variation, not new documents. At temperature 0, Gemini's three runs were identical, so they carry little more than one.
- 0 errors in 20 documents still allows a true silent error rate up to about 14%.
- This is revisited when the private set of client documents is run.

## Alternatives considered

- **Keep Luna, with prompt v2:** an eleventh of the cost, but it misses the silent-error target on the gold set itself.
- **Opus 5.5:** 0 of 20 in its single run (#52), at about 5.5 times Gemini's cost. Not needed on this evidence.
- **Luna first, then Gemini when a check fails:** cheaper, but Luna's mistakes here pass every check, so they would never reach Gemini.
