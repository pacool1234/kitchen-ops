# Eval: openai/gpt-6-luna, prompt v1, gold set, 2026-10-18

20 of 20 documents run. Spending cap $0.250000.

## Silent error rate

0 of 20 (0.0%): passed validation, but wrong.

## Review rate

1 of 20 (5.0%): sent to a person.
By reason: validation 1.

Correct: 19 of 20 (95.0%).

## Header field accuracy

Over the 20 documents that produced a document.

| Field | Right |
| --- | --- |
| documentType | 20 of 20 (100.0%) |
| supplier.name | 19 of 20 (95.0%) |
| supplier.taxId | 20 of 20 (100.0%) |
| number | 20 of 20 (100.0%) |
| issueDate | 20 of 20 (100.0%) |
| totals.net | 20 of 20 (100.0%) |
| totals.total | 20 of 20 (100.0%) |
| totals.vat | 20 of 20 (100.0%) |

## Line precision and recall

- Precision (lines found that exist): 283 of 284 (99.6%)
- Recall (lines that exist that were found): 283 of 284 (99.6%)

## Line field accuracy

Over the 283 matched lines.

| Field | Right |
| --- | --- |
| supplierCode | 283 of 283 (100.0%) |
| description | 283 of 283 (100.0%) |
| quantity | 282 of 283 (99.6%) |
| unit | 283 of 283 (100.0%) |
| unitPrice | 283 of 283 (100.0%) |
| discountPercent | 283 of 283 (100.0%) |
| vatRate | 283 of 283 (100.0%) |
| lineTotal | 283 of 283 (100.0%) |

## Cost per document

$0.001037 per document, over 17 with a reported cost; $0.017632 in all.
3 needed no model call.

## Latency

p50 7223 ms, p95 24748 ms, over 17 calls.

## Structured-output failure rate

0 of 17 (0.0%) calls: structured output was requested and the first answer didn't match the schema.
