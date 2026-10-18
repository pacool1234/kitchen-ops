# Eval: google/gemini-3.8-flash, prompt v2, gold set, 2026-10-18, run 2

20 of 20 documents run. Spending cap $1.000000.

## Silent error rate

0 of 20 (0.0%): passed validation, but wrong.

## Review rate

0 of 20 (0.0%): sent to a person.

Correct: 20 of 20 (100.0%).

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
| quantity | 284 of 284 (100.0%) |
| unit | 284 of 284 (100.0%) |
| unitPrice | 284 of 284 (100.0%) |
| discountPercent | 284 of 284 (100.0%) |
| vatRate | 284 of 284 (100.0%) |
| lineTotal | 284 of 284 (100.0%) |

## Cost per document

$0.011084 per document, over 17 with a reported cost; $0.188429 in all.
3 needed no model call.

## Latency

p50 12635 ms, p95 40733 ms, over 17 calls.

## Structured-output failure rate

0 of 17 (0.0%) calls: structured output was requested and the first answer didn't match the schema.
