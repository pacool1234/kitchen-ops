# 0036. A model suggests the product of a line nothing matches, once, when the document is read

- Status: Accepted
- Date: 2026-10-21

## Context

Spec section 5, stage 5 (Decided) ends with "an LLM-proposed match": a line matched by neither its supplier code nor its exact description (decision 0035) gets a product suggested by a model, which a person confirms or changes (#117). Matching is worked out each time it's asked for; a model call costs money and takes seconds, so it can't be.

A suggestion sends the line's text to a model: it's a client document's contents, like reading is.

## Decision

1. **When:** in the reading job, right after a document is read and checked, once. Only the lines that match nothing are asked about, and only if there are any and the catalogue has active products. The suggestions are ready when the review screen opens.
2. **A failed call doesn't fail the reading.** It's recorded, with what it cost, and its lines simply have no suggestion. Reading is what the job is for; a suggestion only saves typing.
3. **What's sent:** the lines (number, code, description, unit as printed) and the active products (number, name, base unit, category), numbered from 1. The model answers each line with a product's number, or null. Numbers instead of IDs: fewer tokens, and a model can't invent a product that exists. Anything that doesn't fit is dropped, never guessed: a number outside the list, a line not asked about, a line answered twice.
4. **The same rules as reading** (decision 0007, `.claude/rules/extract.md`):
   - client routing, always: `suggestProducts` has no option to leave it out;
   - the reply checked against a Zod schema in `packages/shared`, one retry with the errors, then no suggestions;
   - the model and prompt from `packages/extract/config/models.json` (`suggestion`), the prompt a versioned file (`prompts/suggestions/v1.md`);
   - tests with a fake client, no network.
5. **The default model is reading's, Gemini 3.8 Flash,** at the provider's temperature (decision 0031). This is a much easier task than reading a photo; the cheaper models can be compared once there's an eval for it.
6. **Stored:** each call in `suggestion_calls` (model, prompt version, tokens, cost, latency, outcome), and each line's answer in `line_suggestions`, by the line's code and description as read. The matching answer finds a line's suggestion by its code and description (compared as decision 0035 compares descriptions), not its position, so lines added, removed or reordered in review (#118) keep theirs, and an edited line loses it rather than showing another line's.
7. **Never applied without a person:** a suggestion shows as `by: "suggestion"`, with the product, and the line still counts among `unmapped_lines`. Confirming it is the mapping endpoint of decision 0035, which remembers it as a supplier product.
8. **Its cost is the document's:** the reading cost the owner sees includes the suggestion calls.

**Cost:** about 400 products of about 12 tokens each, so about 5,000 input tokens a call: about $0.005 with Gemini 3.8 Flash through Vertex. At most about $1.50 a month at 300 documents, falling as mappings are remembered.

## Alternatives considered

- **Asking when the review screen opens:** a screen that waits seconds for a model, or one more endpoint for it to call; and the cost would depend on how often a document is opened.
- **Product IDs in the prompt and the answer:** about 3 times the tokens for the list, and an answer could name an ID that isn't one of ours.
- **Suggestions by position in the draft:** wrong as soon as a line is added or removed in review.
- **Retrying a failed call with the job:** a reading that worked would be done again, and paid for again, for a suggestion.
