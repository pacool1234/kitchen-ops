# Gold set

Committed eval documents: own, public or synthetic, never client documents. Each folder holds one `source.*`, its `expected.json` checked by a person, and a `meta.json`.

Written from each folder's `meta.json` by `pnpm --filter @kitchen-ops/extract gold:readme`. Don't edit it by hand: edit the `meta.json` and run that instead.

11 documents: 8 text-pdf, 0 scan, 0 photo, 3 facturae-xml.

| Folder | Origin | Kind | Made | What makes it hard |
| --- | --- | --- | --- | --- |
| syn-001-delivery-note-no-prices | synthetic | text-pdf | rendered | Delivery note without prices: totals, prices, discounts and VAT are all null. Quantities in boxes, units, kg (one with a decimal) and bunches. |
| syn-002-invoice-discounts-two-vat | synthetic | text-pdf | rendered | Invoice with line discounts on some lines and none on others, 10% VAT on food and 21% on cleaning products, a two-row VAT breakdown. One line total rounds a half cent away from zero (18.75 less 10% is 16.875). |
| syn-003-invoice-multi-page | synthetic | text-pdf | rendered | 48 lines over two pages; the totals are only on the last page. Weights with three decimals, a 3% discount on shellfish, and one line (ice) at 21% VAT among 10% ones. |
| syn-004-delivery-note-mixed-units | synthetic | text-pdf | rendered | A priced delivery note (albarán valorado) with totals. Weights printed with three decimals (2,350 kg is 2.35 kg, not 2350), boxes and units on the same document. |
| syn-005-credit-note | synthetic | text-pdf | rendered | A credit note (factura rectificativa) for two returned items: negative quantities, line totals, VAT and total. Its first line total rounds a half cent away from zero, to -36.58. |
| syn-006-facturae | synthetic | facturae-xml | | A Facturae 3.2.2 e-invoice, read without a model. The series and number are separate elements; prices carry six decimals and the discount rate four; three VAT rates (4%, 10%, 21%); unit codes for box, unit, kilogram and package. Valid against the official 3.2.2 schema, unsigned. |
| syn-007-invoice-three-vat-rates | synthetic | text-pdf | elsewhere | It has 12 lines on one page and difficulty is medium |
| syn-008-invoice-two-pages-totals-last | synthetic | text-pdf | elsewhere | It has 27 lines over two A4 pages, with the totals only on page 2. Difficulty is hard |
| syn-009-credit-note-returned-drinks | synthetic | text-pdf | elsewhere | It credits returned drinks from invoice F-2026/01987. It has 8 lines on one page and difficulty is medium |
| syn-010-facturae-credit-note-price-correction | synthetic | facturae-xml | | A Facturae 3.2.1 corrective invoice (rectificativa por diferencias, class OR) correcting prices, not returning goods: quantities are positive and unit prices negative. The seller is a self-employed person, so the name is joined from a first name and two surnames. At 4% the per-line VAT amounts add up to -0.68, but the invoice states -0.67, worked out on the base. The original invoice it corrects is only in the Corrective block. Valid against the official 3.2.1 schema, unsigned. |
| syn-011-facturae-v3-2-no-series | synthetic | facturae-xml | | A Facturae 3.2 e-invoice, the oldest supported namespace. No series, and a slash in the number. The seller's tax ID is written with a hyphen. Weights with three decimals (12.480 kg is 12.48), a unit price with three decimals, a 3% discount rounded once on the line, a line without an article code, and three VAT rates. Valid against the official 3.2 schema, unsigned. |
