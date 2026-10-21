import { z } from "zod";

// What extraction returns for one supplier document (spec section 5, stage 3). The LLM is asked
// for exactly this shape, the validation checks and the eval compare against it, and the API
// will store it.
//
// Every printed value is nullable: null means "not printed, or unreadable", so a model never has
// to invent one. The validation checks decide which nulls send a document to review. Keys are
// never optional: strict structured output needs every property listed as required.
//
// The descriptions end up in the JSON Schema given to models, so they are instructions too.

/** Document types extraction recognises. A credit note is an invoice with negative amounts. */
export const EXTRACTED_DOCUMENT_TYPES = ["delivery-note", "invoice"] as const;

const DECIMAL_FORMAT =
  'Text, with a point as the decimal separator and no thousands separator: "1.234,56" on the document is "1234.56".';

/** A signed decimal string with at most `decimals` decimal places, or null. */
function decimal(decimals: number, description: string) {
  return z
    .string()
    .regex(
      new RegExp(`^-?\\d+(\\.\\d{1,${decimals}})?$`),
      `must be a decimal with at most ${decimals} decimals, written with a point`,
    )
    .nullable()
    .describe(`${description} ${DECIMAL_FORMAT} null if not printed.`);
}

/** A percentage from 0 to 100 with at most 2 decimals, as a string, or null. */
function percentage(description: string) {
  return z
    .string()
    .regex(
      /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/,
      "must be a percentage from 0 to 100 with at most 2 decimals",
    )
    .nullable()
    .describe(`${description} "21" for 21%. null if not printed.`);
}

function text(description: string) {
  return z
    .string()
    .min(1)
    .nullable()
    .describe(`${description} null if not printed.`);
}

/** Money: euros with 2 decimals (decision 0015). */
const money = (description: string) => decimal(2, description);

export const VatAmount = z
  .object({
    rate: percentage("The VAT rate."),
    base: money("The taxable base at this rate, in euros."),
    amount: money("The VAT at this rate, in euros."),
  })
  .describe("One row of the VAT breakdown: one per rate.");
export type VatAmount = z.infer<typeof VatAmount>;

export const ExtractedLine = z
  .object({
    supplierCode: text("The supplier's own code for the product."),
    description: text("The product, as printed on the line."),
    quantity: decimal(
      6,
      "The quantity, in the line's unit. Negative for returns.",
    ),
    unit: text("The unit, as printed: kg, caja, ud, botella…"),
    unitPrice: decimal(
      6,
      "The price per unit, as printed: before discount, excluding VAT.",
    ),
    discountPercent: percentage(
      'The line discount (the "Dto." column) as a percentage.',
    ),
    vatRate: percentage("The VAT rate that applies to this line."),
    lineTotal: money(
      "The line total, as printed: after discount, excluding VAT.",
    ),
  })
  .describe("One product line.");
export type ExtractedLine = z.infer<typeof ExtractedLine>;

export const ExtractedDocument = z.object({
  documentType: z
    .enum(EXTRACTED_DOCUMENT_TYPES)
    .describe(
      "delivery-note for a delivery note (albarán); invoice for an invoice (factura), including credit notes (facturas rectificativas), whose amounts are negative.",
    ),
  currency: z.literal("EUR").describe("Always EUR."),
  supplier: z
    .object({
      name: text(
        "The supplier's legal name, as printed with its tax ID: the company name or the person's full name, never a brand, logo or trade name.",
      ),
      taxId: z
        .string()
        .regex(
          /^[A-Z0-9]+$/,
          "must be upper-case letters and digits, without spaces, dots or hyphens",
        )
        .nullable()
        .describe(
          'The supplier\'s tax ID (NIF or CIF), in upper case, without spaces, dots or hyphens: "B-12.345.678" is "B12345678". Keep a country prefix such as ES if printed. null if not printed.',
        ),
    })
    .describe("Who issued the document."),
  number: text("The document number, as printed."),
  issueDate: z.iso
    .date()
    .nullable()
    .describe("The issue date, as YYYY-MM-DD. null if not printed."),
  // #120. A draft the API saved before this field is read as listing none (apps/api's
  // storedDraft); here, the list is always written, [] for none.
  deliveryNotes: z
    .array(z.string().min(1))
    .describe(
      "The numbers of the delivery notes (albaranes) the document says it bills, each as printed, in the order printed. An invoice often lists them in its header, in its notes, or above each group of lines. Empty if it lists none, and on a delivery note.",
    ),
  totals: z
    .object({
      net: money("The total before VAT, in euros."),
      vat: z
        .array(VatAmount)
        .describe("The VAT breakdown, one row per rate. Empty if not printed."),
      total: money("The total to pay, including VAT, in euros."),
    })
    .nullable()
    .describe(
      "The document's totals. null when it shows no prices, as some delivery notes don't.",
    ),
  lines: z
    .array(ExtractedLine)
    .min(1)
    .describe(
      "Every product line, in the order printed. Not subtotal, VAT or total rows.",
    ),
});
export type ExtractedDocument = z.infer<typeof ExtractedDocument>;

/** The JSON Schema for `ExtractedDocument`, for models that support structured output. */
export function extractedDocumentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ExtractedDocument);
}
