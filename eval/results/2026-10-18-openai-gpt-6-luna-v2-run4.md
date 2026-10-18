# Eval: openai/gpt-6-luna, prompt v2, gold set, 2026-10-18, run 4

20 of 20 documents run. Spending cap $0.250000.

## Silent error rate

1 of 20 (5.0%): passed validation, but wrong.

## Review rate

1 of 20 (5.0%): sent to a person.
By reason: validation 1.

Correct: 18 of 20 (90.0%).

## Header field accuracy

Over the 20 documents that produced a document.

| Field | Right |
| --- | --- |
| documentType | 20 of 20 (100.0%) |
| supplier.name | 20 of 20 (100.0%) |
| supplier.taxId | 20 of 20 (100.0%) |
| number | 20 of 20 (100.0%) |
| issueDate | 20 of 20 (100.0%) |
| totals.net | 20 of 20 (100.0%) |
| totals.total | 20 of 20 (100.0%) |
| totals.vat | 20 of 20 (100.0%) |

## Line precision and recall

- Precision (lines found that exist): 284 of 284 (100.0%)
- Recall (lines that exist that were found): 284 of 284 (100.0%)

## Line field accuracy

Over the 284 matched lines.

| Field | Right |
| --- | --- |
| supplierCode | 284 of 284 (100.0%) |
| description | 284 of 284 (100.0%) |
| quantity | 283 of 284 (99.6%) |
| unit | 283 of 284 (99.6%) |
| unitPrice | 284 of 284 (100.0%) |
| discountPercent | 283 of 284 (99.6%) |
| vatRate | 284 of 284 (100.0%) |
| lineTotal | 284 of 284 (100.0%) |

## Cost per document

$0.000857 per document, over 17 with a reported cost; $0.014563 in all.
3 needed no model call.

## Latency

p50 9483 ms, p95 31840 ms, over 17 calls.

## Structured-output failure rate

0 of 17 (0.0%) calls: structured output was requested and the first answer didn't match the schema.
