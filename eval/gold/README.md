# Gold set

Committed eval documents: own, public or synthetic, never client documents. Each folder holds one `source.*`, its `expected.json` checked by a person, and a `meta.json`.

Written from each folder's `meta.json` by `pnpm --filter @kitchen-ops/extract gold:readme`. Don't edit it by hand: edit the `meta.json` and run that instead.

20 documents: 10 text-pdf, 2 scan, 5 photo, 3 facturae-xml.

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
| syn-012-delivery-note-no-prices | synthetic | text-pdf | elsewhere | It has 16 lines on one page, with cleaning supplies and dry goods, and no prices. Difficulty is medium. |
| syn-013-invoice-multi-page | synthetic | text-pdf | elsewhere | It has 38 lines over two pages, with 24 on page 1 and 14 plus the totals on page 2. Difficulty is hard, mostly from volume and number formats. |
| syn-014-picture-from-001 | synthetic | photo | | Photo of syn-001 printed |
| syn-015-picture-from-002 | synthetic | photo | | Photo of syn-002 printed: taken at an angle, with the page sideways in the picture (rotated 90 degrees) and a shadow across it |
| syn-016-picture-from-003 | synthetic | scan | | Scan of syn-003 printed |
| syn-017-picture-from-004 | synthetic | photo | | Photo of syn-004 printed |
| syn-018-picture-from-005 | synthetic | photo | | Photo of syn-005 printed |
| syn-019-picture-from-007 | synthetic | photo | | Photo of syn-007 printed |
| syn-020-picture-from-008 | synthetic | scan | | Scan of syn-008 printed: first page is blank |
