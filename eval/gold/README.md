# Gold set

Committed eval documents: own, public or synthetic, never client documents. Each folder holds one `source.*`, its `expected.json` checked by a person, and a `meta.json`.

Written from each folder's `meta.json` by `pnpm --filter @kitchen-ops/extract gold:readme`. Don't edit it by hand: edit the `meta.json` and run that instead.

9 documents: 8 text-pdf, 0 scan, 0 photo, 1 facturae-xml.

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
