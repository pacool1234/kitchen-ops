import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ExtractedDocument,
  extractedDocumentJsonSchema,
  type ExtractedLine,
} from "./extraction";

// Synthetic examples: fictional suppliers, written by hand.

/** A delivery note (albarán) that shows no prices. */
const deliveryNote: ExtractedDocument = {
  documentType: "delivery-note",
  currency: "EUR",
  supplier: { name: "Huerta Ejemplo S.L.", taxId: "B00000000" },
  number: "ALB-0042",
  issueDate: "2026-10-14",
  deliveryNotes: [],
  totals: null,
  lines: [
    {
      supplierCode: "TOM-01",
      description: "Tomate pera",
      quantity: "1.5",
      unit: "caja",
      unitPrice: null,
      discountPercent: null,
      vatRate: null,
      lineTotal: null,
    },
  ],
};

/** An invoice with a discount and two VAT rates (10% food, 21% cleaning products). */
const invoice: ExtractedDocument = {
  documentType: "invoice",
  currency: "EUR",
  supplier: { name: "Distribuciones Ejemplo S.A.", taxId: "ESA00000000" },
  number: "F-2026/0315",
  issueDate: "2026-10-15",
  // The delivery notes it bills, as printed (#120).
  deliveryNotes: ["ALB-0042", "ALB-0045"],
  totals: {
    // 1.5 × 12.00 − 5% = 17.10; 2 × 3.50 = 7.00; net 24.10.
    // VAT: 17.10 × 10% = 1.71; 7.00 × 21% = 1.47; total 24.10 + 3.18 = 27.28.
    net: "24.10",
    vat: [
      { rate: "10", base: "17.10", amount: "1.71" },
      { rate: "21", base: "7.00", amount: "1.47" },
    ],
    total: "27.28",
  },
  lines: [
    {
      supplierCode: "TOM-01",
      description: "Tomate pera",
      quantity: "1.5",
      unit: "caja",
      unitPrice: "12.00",
      discountPercent: "5",
      vatRate: "10",
      lineTotal: "17.10",
    },
    {
      supplierCode: null,
      description: "Lejía 5 L",
      quantity: "2",
      unit: "ud",
      unitPrice: "3.50",
      discountPercent: null,
      vatRate: "21",
      lineTotal: "7.00",
    },
  ],
};

const firstLine = invoice.lines[0] as ExtractedLine;

/** The paths of every problem, e.g. "lines.0.quantity". */
function problems(value: unknown): string[] {
  const result = ExtractedDocument.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
}

describe("ExtractedDocument: what extraction returns", () => {
  it("a delivery note without prices parses: totals and prices are null", () => {
    expect(ExtractedDocument.parse(deliveryNote)).toEqual(deliveryNote);
  });

  it("an invoice with a discount and two VAT rates parses", () => {
    expect(ExtractedDocument.parse(invoice)).toEqual(invoice);
  });

  it("a credit note is an invoice with negative amounts", () => {
    const credit = {
      ...invoice,
      totals: {
        net: "-7.00",
        vat: [{ rate: "21", base: "-7.00", amount: "-1.47" }],
        total: "-8.47",
      },
      lines: [{ ...firstLine, quantity: "-2", lineTotal: "-7.00" }],
    };
    expect(problems(credit)).toEqual([]);
  });

  it("every printed value may be null: not printed, or unreadable", () => {
    const unreadable = {
      ...invoice,
      supplier: { name: null, taxId: null },
      number: null,
      issueDate: null,
      totals: { net: null, vat: [], total: null },
      lines: [
        {
          supplierCode: null,
          description: null,
          quantity: null,
          unit: null,
          unitPrice: null,
          discountPercent: null,
          vatRate: null,
          lineTotal: null,
        },
      ],
    };
    expect(problems(unreadable)).toEqual([]);
  });

  it("a draft read before it listed delivery notes is read as listing none (#120)", () => {
    const { deliveryNotes: _, ...before } = invoice;
    expect(ExtractedDocument.parse(before)).toEqual({
      ...invoice,
      deliveryNotes: [],
    });
  });

  it("drops keys it doesn't know, instead of failing on them", () => {
    expect(ExtractedDocument.parse({ ...invoice, notes: "x" })).toEqual(
      invoice,
    );
  });
});

describe("ExtractedDocument: rejected, with the path to the bad field", () => {
  it("an empty delivery-note number in the list (#120)", () => {
    expect(problems({ ...invoice, deliveryNotes: ["ALB-0042", ""] })).toEqual([
      "deliveryNotes.1",
    ]);
  });

  it("a number instead of a decimal string", () => {
    expect(
      problems({ ...invoice, lines: [{ ...firstLine, quantity: 1.5 }] }),
    ).toEqual(["lines.0.quantity"]);
  });

  it('money with three decimals: "12.505"', () => {
    expect(
      problems({ ...invoice, lines: [{ ...firstLine, lineTotal: "12.505" }] }),
    ).toEqual(["lines.0.lineTotal"]);
  });

  it('Spanish formatting left in: "1.234,56", or a thousands separator: "1,234.56"', () => {
    expect(
      problems({ ...invoice, totals: { ...invoice.totals, net: "1.234,56" } }),
    ).toEqual(["totals.net"]);
    expect(
      problems({ ...invoice, totals: { ...invoice.totals, net: "1,234.56" } }),
    ).toEqual(["totals.net"]);
  });

  it("a missing line field: null is allowed, a missing key is not", () => {
    const withoutUnit: Partial<ExtractedLine> = { ...firstLine };
    delete withoutUnit.unit;
    expect(problems({ ...invoice, lines: [withoutUnit] })).toEqual([
      "lines.0.unit",
    ]);
  });

  it("an unknown document type", () => {
    expect(problems({ ...invoice, documentType: "receipt" })).toEqual([
      "documentType",
    ]);
  });

  it("a currency other than euros", () => {
    expect(problems({ ...invoice, currency: "USD" })).toEqual(["currency"]);
  });

  it("no lines", () => {
    expect(problems({ ...invoice, lines: [] })).toEqual(["lines"]);
  });

  it("a discount above 100%, or a negative VAT rate", () => {
    expect(
      problems({
        ...invoice,
        lines: [{ ...firstLine, discountPercent: "101", vatRate: "-10" }],
      }),
    ).toEqual(["lines.0.discountPercent", "lines.0.vatRate"]);
  });

  it("a date that isn't YYYY-MM-DD, or doesn't exist", () => {
    expect(problems({ ...invoice, issueDate: "15/10/2026" })).toEqual([
      "issueDate",
    ]);
    expect(problems({ ...invoice, issueDate: "2026-02-30" })).toEqual([
      "issueDate",
    ]);
  });

  it("a tax ID with spaces, dots, hyphens or lower case", () => {
    for (const taxId of [
      "B 00000000",
      "B-00000000",
      "B.000.000.00",
      "b00000000",
    ]) {
      expect(
        problems({ ...invoice, supplier: { ...invoice.supplier, taxId } }),
      ).toEqual(["supplier.taxId"]);
    }
  });
});

describe("decimal fields accept exactly the decimals they allow", () => {
  // A whole part, and 0 to 8 decimal digits.
  const decimal = fc.record({
    negative: fc.boolean(),
    whole: fc.nat({ max: 1_000_000 }),
    digits: fc.string({ unit: fc.constantFrom(..."0123456789"), maxLength: 8 }),
  });
  const text = ({
    negative,
    whole,
    digits,
  }: {
    negative: boolean;
    whole: number;
    digits: string;
  }) => `${negative ? "-" : ""}${whole}${digits === "" ? "" : `.${digits}`}`;

  it("a decimal string parses exactly when it has no more decimals than its field allows: 2 for money, 6 for quantities", () => {
    fc.assert(
      fc.property(decimal, (d) => {
        const line = { ...firstLine, quantity: text(d), lineTotal: text(d) };
        const paths = problems({ ...invoice, lines: [line] });
        expect(paths.includes("lines.0.lineTotal")).toBe(d.digits.length > 2);
        expect(paths.includes("lines.0.quantity")).toBe(d.digits.length > 6);
      }),
    );
  });
});

describe("the JSON Schema given to models for structured output", () => {
  it("lists every property as required and allows no others, as strict structured output needs", () => {
    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node !== "object" || node === null) return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object") {
        const properties = Object.keys(
          schema.properties as Record<string, unknown>,
        );
        expect(schema.required).toEqual(properties);
        expect(schema.additionalProperties).toBe(false);
      }
      Object.values(schema).forEach(visit);
    };
    visit(extractedDocumentJsonSchema());
  });

  it("describes every field, so the schema also tells the model what to put there", () => {
    const schema = extractedDocumentJsonSchema() as {
      properties: Record<string, { description?: string }>;
    };
    for (const [name, property] of Object.entries(schema.properties)) {
      expect(property.description, name).toBeTruthy();
    }
  });

  it("asks for the supplier's legal name, printed with its tax ID, never a trade name (#63)", () => {
    const schema = extractedDocumentJsonSchema() as {
      properties: {
        supplier: { properties: { name: { description?: string } } };
      };
    };
    const description = schema.properties.supplier.properties.name.description;
    expect(description).toMatch(/legal name/);
    expect(description).toMatch(/tax ID/);
    expect(description).toMatch(/never a brand, logo or trade name/);
  });

  it("asks for the delivery notes an invoice lists, as printed, and none on a delivery note (#120)", () => {
    const schema = extractedDocumentJsonSchema() as {
      properties: {
        deliveryNotes: {
          type?: string;
          items?: { type?: string };
          description?: string;
          default?: unknown;
        };
      };
    };
    const listed = schema.properties.deliveryNotes;
    expect(listed.type).toBe("array");
    expect(listed.items?.type).toBe("string");
    // A default isn't part of strict structured output: the model always writes the list.
    expect(listed.default).toBeUndefined();
    expect(listed.description).toMatch(/delivery notes \(albaranes\)/);
    expect(listed.description).toMatch(/as printed/);
    expect(listed.description).toMatch(/Empty/);
  });

  it("only changes on purpose: compared with a committed snapshot", () => {
    expect(extractedDocumentJsonSchema()).toMatchSnapshot();
  });
});
