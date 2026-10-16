# First model comparison on the gold set

## Why

M3 is done when "an eval run reports every metric in section 5 for at least two models or prompts" (spec section 9). This run also chooses the pipeline's default model and prompt.

## Done when

- [ ] Eval runs over the full gold set for:
  - at least two cheap models;
  - one frontier model, as the accuracy ceiling (decision 0007).

  Or two prompts on the same models. Each run stays within the spending cap.
- [ ] The results files and summaries are committed in `eval/results/`.
- [ ] The PR compares the runs:
  - silent error rate per euro spent;
  - review rate against the provisional targets (spec section 5: silent errors below 1%, review below 20%);
  - the most common failure modes.
- [ ] A decision record names the default model and prompt, and why. It is revisited when client documents are tried.
- [ ] The M3 "done when" from spec section 9, checked off with evidence.

## Notes

The repo owner starts the paid runs, or approves each one with its expected cost, since they spend OpenRouter credits.

Depends on "Eval command" and "Gold set of 20–30 documents".

Spec: `docs/spec.md` sections 5, 7 and 9. Decision 0007. Rules: `.claude/rules/extract.md`. Workflow: see "How a session works" in `CLAUDE.md`.
