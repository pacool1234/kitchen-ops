# Eval: anthropic/claude-opus-5.5, prompt v1, gold set, 2026-10-18

20 of 20 documents run. Spending cap $3.000000.

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

$0.059390 per document, over 17 with a reported cost; $1.009636 in all.
3 needed no model call.

## Latency

p50 9622 ms, p95 35627 ms, over 17 calls.

## Structured-output failure rate

Not requested: the schema went in the prompt.
