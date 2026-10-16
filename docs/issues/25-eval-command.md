# Eval command: one run, a results file and a summary

## Why

Comparing models and prompts must be one command whose results are committed, so runs can be compared over time (spec section 5, "Evaluation harness").

## Done when

- [ ] One command, e.g. `pnpm --filter @kitchen-ops/extract eval -- --set gold --model <id> --prompt v1` (several models allowed):
  - runs every document of the set through routing, extraction and validation;
  - writes `eval/results/<date>-<model>-<prompt>.json` and a Markdown summary next to it.
- [ ] The summary reports, in this order:
  - silent error rate;
  - review rate;
  - header field accuracy;
  - line precision and recall;
  - line field accuracy;
  - cost per document;
  - latency (p50, p95);
  - structured-output failure rate per model.
- [ ] **A spending cap:** the run stops once its cost passes a configured limit, and says so in the summary. The monthly budget (spec section 7) covers OpenRouter too.
- [ ] **The private set:**
  - it is found through an environment variable the repo owner sets, never through a path written in the code;
  - it always uses the restricted routing from "LLM extraction through OpenRouter";
  - its results are written outside the repo's tracked files.
- [ ] Tests run the command's logic over two small synthetic fixtures with a mocked client.

## Notes

Runs over the private set are started by the repo owner, never by Claude (`.claude/rules/extract.md`). Results for the gold set may include extracted values, since gold documents are own, public or synthetic. Results for the private set must never be committed.

Depends on "Eval metrics", "Routing" and "Validation checks".

Spec: `docs/spec.md` sections 5 and 7. Rules: `.claude/rules/extract.md`. Workflow: see "How a session works" in `CLAUDE.md`.
