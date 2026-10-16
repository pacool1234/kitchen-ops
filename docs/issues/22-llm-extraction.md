# LLM extraction through OpenRouter

## Why

Most documents are PDFs and photos, so an LLM reads them. Every call must be validated, retried at most once, and safe for client documents (spec section 5, stage 3; decision 0007).

## Done when

- [ ] An OpenRouter client in `packages/extract` that reads `OPENROUTER_API_KEY` from the environment. The repo owner adds the variable's name to `.env.example`.
- [ ] Model IDs and prompt versions come from config, never from pipeline code. Prompts are versioned files, e.g. `packages/extract/prompts/v1.md`.
- [ ] Each call:
  - asks for structured output using the generated JSON Schema, where the model supports it;
  - validates the response with the Zod schema;
  - on invalid output, retries once with the validation errors;
  - if it's still invalid, returns a "needs review" result naming why. Output is never repaired by guessing.
- [ ] **Client documents can only be sent with restricted routing.** Extracting from the private set requires a routing policy, which sets OpenRouter's options to exclude providers that train on or retain data. It is enforced by the types or a required argument, so it can't be forgotten. A test shows the request body carries it.
- [ ] Each call records: model, prompt version, attempts, tokens, cost (OpenRouter's usage accounting), latency, and whether structured output failed.
- [ ] Unit tests mock the HTTP client: no network calls in tests.

## Notes

The plan should decide between `fetch` and an SDK; `fetch` keeps the dependency count down.

Depends on "Extraction result schema".

Spec: `docs/spec.md` section 5. Decision 0007. Rules: `.claude/rules/extract.md`. Workflow: see "How a session works" in `CLAUDE.md`.
