# Eval: openai/gpt-6-luna, prompt v2, gold set, 2026-10-18, run 2

20 of 20 documents run. Spending cap $0.250000.

## Silent error rate

0 of 20 (0.0%): passed validation, but wrong.

## Review rate

2 of 20 (10.0%): sent to a person.
By reason: validation 2.

Correct: 18 of 20 (90.0%).

## Header field accuracy

Over the 20 documents that produced a document.

| Field | Right |
| --- | --- |
| documentType | 20 of 20 (100.0%) |
| supplier.name | 20 of 20 (100.0%) |
| supplier.taxId | 20 of 20 (100.0%) |
| number | 19 of 20 (95.0%) |
| issueDate | 19 of 20 (95.0%) |
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
| unit | 282 of 284 (99.3%) |
| unitPrice | 284 of 284 (100.0%) |
| discountPercent | 282 of 284 (99.3%) |
| vatRate | 284 of 284 (100.0%) |
| lineTotal | 284 of 284 (100.0%) |

## Cost per document

$0.001124 per document, over 17 with a reported cost; $0.019104 in all.
3 needed no model call.

## Latency

p50 10094 ms, p95 30870 ms, over 17 calls.

## Structured-output failure rate

0 of 17 (0.0%) calls: structured output was requested and the first answer didn't match the schema.
