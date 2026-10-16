# Eval metrics: comparing results with gold answers

## Why

Spec section 5 lists the metrics an eval run reports. The most important is the silent error rate: documents that pass validation but are wrong. Computing these as pure, tested functions keeps the numbers trustworthy.

## Done when

- [ ] Pure functions that compare a result with its gold answer:
  - **header field accuracy**, per field: supplier, tax ID, date, number, totals;
  - **line precision and recall:** lines found vs lines that exist, using a line-matching rule decided in the plan;
  - **line field accuracy** within matched lines: quantity, unit, price, discount, VAT, line total;
  - **document correct:** every header field and every line matches.
- [ ] The per-document outcome is exactly one of:
  - **correct**;
  - **silent error:** passed validation but not correct;
  - **sent to review:** failed validation or needed review.

  The run's silent error rate and review rate are computed from these.
- [ ] **Normalization rules are written down and tested:**
  - decimals compare by value (`"1.50"` equals `"1.5"`);
  - descriptions ignore case and repeated spaces;
  - dates compare as dates.
- [ ] **Cost per document and latency** (p50 and p95) come from the call records.
- [ ] Example tests with small hand-made pairs, and property tests:
  - comparing a result with its own gold answer is 100% on every metric and never a silent error;
  - removing one of n lines lowers recall by exactly 1/n;
  - changing any one field makes the document not correct.

## Notes

These functions never print document contents; they return field names and counts.

Depends on "Extraction result schema".

Spec: `docs/spec.md` section 5, metrics table. Rules: `.claude/rules/extract.md`. Workflow: see "How a session works" in `CLAUDE.md`.
