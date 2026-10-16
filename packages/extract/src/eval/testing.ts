import fc from "fast-check";
import type { ExtractedDocument, ExtractedLine } from "@kitchen-ops/shared";

// Generated documents for the eval tests. Not used by the pipeline.

const digits = (maxLength: number) =>
  fc.string({ unit: fc.constantFrom(..."0123456789"), maxLength });

/** A decimal string as the schema allows it, with at most `decimals` decimals. */
export const decimal = (decimals: number) =>
  fc
    .tuple(fc.boolean(), fc.nat({ max: 99_999 }), digits(decimals))
    .map(
      ([negative, whole, fraction]) =>
        `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`,
    );

const percentage = fc
  .tuple(fc.nat({ max: 99 }), digits(2))
  .map(([whole, fraction]) =>
    fraction === "" ? `${whole}` : `${whole}.${fraction}`,
  );

/** Printed text, with the case and spacing differences the comparison ignores. */
const text = fc.string({
  unit: fc.constantFrom(..."abcñáXYZ019 -/.,"),
  minLength: 1,
  maxLength: 20,
});

const date = fc
  .integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2030, 11, 31) })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));

const nullable = <T>(value: fc.Arbitrary<T>) => fc.option(value, { nil: null });

export const line: fc.Arbitrary<ExtractedLine> = fc.record({
  supplierCode: nullable(text),
  description: nullable(text),
  quantity: nullable(decimal(6)),
  unit: nullable(text),
  unitPrice: nullable(decimal(6)),
  discountPercent: nullable(percentage),
  vatRate: nullable(percentage),
  lineTotal: nullable(decimal(2)),
});

/** Any document the schema accepts, nulls included. */
export const document: fc.Arbitrary<ExtractedDocument> = fc.record({
  documentType: fc.constantFrom("delivery-note" as const, "invoice" as const),
  currency: fc.constant("EUR" as const),
  supplier: fc.record({
    name: nullable(text),
    taxId: nullable(
      fc.string({
        unit: fc.constantFrom(..."ABX0123456789"),
        minLength: 1,
        maxLength: 11,
      }),
    ),
  }),
  number: nullable(text),
  issueDate: nullable(date),
  totals: nullable(
    fc.record({
      net: nullable(decimal(2)),
      vat: fc.array(
        fc.record({
          rate: nullable(percentage),
          base: nullable(decimal(2)),
          amount: nullable(decimal(2)),
        }),
        { maxLength: 3 },
      ),
      total: nullable(decimal(2)),
    }),
  ),
  lines: fc.array(line, { minLength: 1, maxLength: 6 }),
});
