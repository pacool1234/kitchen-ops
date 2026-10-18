import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ExtractedDocument, ExtractedLine } from "@kitchen-ops/shared";
import {
  compareDocument,
  HEADER_FIELDS,
  LINE_FIELDS,
  type HeaderField,
} from "./compare";
import { document } from "./testing";

// A fictional invoice, as a gold answer.
const gold: ExtractedDocument = {
  documentType: "invoice",
  currency: "EUR",
  supplier: { name: "Huerta Ficticia S.L.", taxId: "B00123455" },
  number: "F-1",
  issueDate: "2026-10-14",
  totals: {
    net: "13.70",
    vat: [
      { rate: "4", base: "8.70", amount: "0.35" },
      { rate: "21", base: "5.00", amount: "1.05" },
    ],
    total: "15.10",
  },
  lines: [
    {
      supplierCode: "A-1",
      description: "Tomate pera",
      quantity: "5",
      unit: "kg",
      unitPrice: "1.20",
      discountPercent: null,
      vatRate: "4",
      lineTotal: "6.00",
    },
    {
      supplierCode: "A-2",
      description: "Cebolla",
      quantity: "3",
      unit: "kg",
      unitPrice: "0.90",
      discountPercent: null,
      vatRate: "4",
      lineTotal: "2.70",
    },
    {
      supplierCode: null,
      description: "Portes",
      quantity: "1",
      unit: "ud",
      unitPrice: "5.00",
      discountPercent: null,
      vatRate: "21",
      lineTotal: "5.00",
    },
  ],
};

const withLines = (lines: ExtractedLine[]): ExtractedDocument => ({
  ...gold,
  lines,
});
const [tomato, onion, delivery] = gold.lines as [
  ExtractedLine,
  ExtractedLine,
  ExtractedLine,
];

describe("compareDocument: a result against its gold answer", () => {
  it("the gold answer itself is correct, with every field right", () => {
    const comparison = compareDocument(gold, gold);
    expect(comparison.correct).toBe(true);
    expect(comparison.differences).toEqual([]);
    expect(Object.values(comparison.header).every(Boolean)).toBe(true);
    expect(comparison.lines).toMatchObject({ gold: 3, result: 3, matched: 3 });
  });

  it("lines are matched by code, then description, so their order doesn't matter", () => {
    const comparison = compareDocument(
      withLines([delivery, onion, tomato]),
      gold,
    );
    expect(comparison.correct).toBe(true);
  });

  it("a line matched by its code still has its description compared", () => {
    const comparison = compareDocument(
      withLines([{ ...tomato, description: "Tomate rama" }, onion, delivery]),
      gold,
    );
    expect(comparison.differences).toEqual(["lines.0.description"]);
    expect(comparison.lines.matched).toBe(3);
  });

  it("a line without a code is matched by its description, ignoring case and spaces", () => {
    const comparison = compareDocument(
      withLines([tomato, onion, { ...delivery, description: "  PORTES " }]),
      gold,
    );
    expect(comparison.correct).toBe(true);
  });

  it("a missed line lowers recall; an invented one lowers precision", () => {
    const missed = compareDocument(withLines([tomato, delivery]), gold);
    expect(missed.lines).toMatchObject({ gold: 3, result: 2, matched: 2 });
    expect(missed.differences).toEqual(["lines.1: not found"]);

    const invented = compareDocument(
      withLines([
        tomato,
        onion,
        delivery,
        { ...delivery, description: "Subtotal" },
      ]),
      gold,
    );
    expect(invented.lines).toMatchObject({ gold: 3, result: 4, matched: 3 });
    expect(invented.differences).toEqual([
      "result line 3: not in the gold answer",
    ]);
  });

  it("decimals written differently but equal in value are right", () => {
    const comparison = compareDocument(
      withLines([
        { ...tomato, unitPrice: "1.2", lineTotal: "6" },
        onion,
        delivery,
      ]),
      gold,
    );
    expect(comparison.correct).toBe(true);
  });

  it("a blank discount read as 0% is right: the ledger posts both the same (#72, decision 0019)", () => {
    const comparison = compareDocument(
      withLines([
        { ...tomato, discountPercent: "0" },
        { ...onion, discountPercent: "0.00" },
        delivery,
      ]),
      gold,
    );
    expect(comparison.correct).toBe(true);
    expect(comparison.differences).toEqual([]);
  });

  it("only for the discount: a blank quantity or price read as 0 is still wrong", () => {
    const blank = withLines([
      { ...tomato, quantity: null, unitPrice: null },
      onion,
      delivery,
    ]);
    const comparison = compareDocument(
      withLines([
        { ...tomato, quantity: "0", unitPrice: "0" },
        onion,
        delivery,
      ]),
      blank,
    );
    expect(comparison.differences).toEqual([
      "lines.0.quantity",
      "lines.0.unitPrice",
    ]);
  });

  it("the VAT breakdown is one field: the same rows in any order, each with the same rate, base and amount", () => {
    const vat = gold.totals!.vat;
    const reordered = compareDocument(
      { ...gold, totals: { ...gold.totals!, vat: [vat[1]!, vat[0]!] } },
      gold,
    );
    expect(reordered.correct).toBe(true);

    const wrongAmount = compareDocument(
      {
        ...gold,
        totals: {
          ...gold.totals!,
          vat: [vat[0]!, { ...vat[1]!, amount: "1.06" }],
        },
      },
      gold,
    );
    expect(wrongAmount.differences).toEqual(["totals.vat"]);
  });

  it("a delivery note without prices: no totals on both sides is right; inventing totals is wrong", () => {
    const note = {
      ...gold,
      documentType: "delivery-note",
      totals: null,
    } as const;
    expect(compareDocument(note, note).correct).toBe(true);
    expect(compareDocument(gold, note).differences).toEqual([
      "documentType",
      "totals.net",
      "totals.total",
      "totals.vat",
    ]);
  });

  it("names fields, never values: a comparison can be logged", () => {
    const comparison = compareDocument(
      { ...gold, number: "F-2", lines: [{ ...tomato, unit: "caja" }] },
      gold,
    );
    const logged = JSON.stringify(comparison);
    for (const value of ["F-2", "caja", "Cebolla", "Portes", "B00123455"]) {
      expect(logged).not.toContain(value);
    }
  });

  it("lines with neither code nor description are matched in order with each other", () => {
    const anonymous = { ...delivery, description: null };
    const doc = withLines([anonymous, { ...anonymous, quantity: "2" }]);
    expect(compareDocument(doc, doc).correct).toBe(true);
  });
});

/** A different value for one field: never equal under the comparison rules. */
function changed(value: string | null, kind: "decimal" | "text"): string {
  if (value === null) return kind === "decimal" ? "1" : "x";
  if (kind === "text") return `${value}x`;
  // A non-zero digit added at the end of the decimals always changes the value.
  return value.includes(".") ? `${value}1` : `${value}.1`;
}

function changeHeader(
  doc: ExtractedDocument,
  field: HeaderField,
): ExtractedDocument {
  const totals = doc.totals ?? { net: null, vat: [], total: null };
  switch (field) {
    case "documentType":
      return {
        ...doc,
        documentType:
          doc.documentType === "invoice" ? "delivery-note" : "invoice",
      };
    case "supplier.name":
      return {
        ...doc,
        supplier: { ...doc.supplier, name: changed(doc.supplier.name, "text") },
      };
    case "supplier.taxId":
      return {
        ...doc,
        supplier: {
          ...doc.supplier,
          taxId: changed(doc.supplier.taxId, "text"),
        },
      };
    case "number":
      return { ...doc, number: changed(doc.number, "text") };
    case "issueDate": {
      const day =
        doc.issueDate === null
          ? Date.UTC(2026, 0, 1)
          : Date.parse(`${doc.issueDate}T00:00:00Z`) + 86_400_000;
      return { ...doc, issueDate: new Date(day).toISOString().slice(0, 10) };
    }
    case "totals.net":
      return {
        ...doc,
        totals: { ...totals, net: changed(totals.net, "decimal") },
      };
    case "totals.total":
      return {
        ...doc,
        totals: { ...totals, total: changed(totals.total, "decimal") },
      };
    case "totals.vat":
      return {
        ...doc,
        totals: {
          ...totals,
          vat: [...totals.vat, { rate: "4", base: "1", amount: "0.04" }],
        },
      };
  }
}

const SCORED_LINE_FIELDS = [
  "quantity",
  "unit",
  "unitPrice",
  "discountPercent",
  "vatRate",
  "lineTotal",
] as const;

describe("compareDocument: properties", () => {
  it("any document compared with itself is correct on every field, line and count", () => {
    fc.assert(
      fc.property(document, (doc) => {
        const comparison = compareDocument(doc, doc);
        expect(comparison.correct).toBe(true);
        expect(comparison.differences).toEqual([]);
        const n = doc.lines.length;
        expect(comparison.lines).toMatchObject({
          gold: n,
          result: n,
          matched: n,
        });
        for (const field of LINE_FIELDS) {
          expect(comparison.lines.fieldsRight[field]).toBe(n);
        }
      }),
    );
  });

  it("removing one of n lines lowers recall by exactly 1/n and leaves precision whole", () => {
    fc.assert(
      fc.property(document, fc.nat(), (doc, pick) => {
        const n = doc.lines.length;
        const removed = pick % n;
        const result = {
          ...doc,
          lines: doc.lines.filter((_line, i) => i !== removed),
        };
        const { lines } = compareDocument(result, doc);
        expect(lines).toMatchObject({ gold: n, result: n - 1, matched: n - 1 });
      }),
    );
  });

  it("changing any one header field makes the document wrong, naming exactly that field", () => {
    fc.assert(
      fc.property(document, fc.constantFrom(...HEADER_FIELDS), (doc, field) => {
        const comparison = compareDocument(changeHeader(doc, field), doc);
        expect(comparison.correct).toBe(false);
        expect(comparison.differences).toEqual([field]);
        expect(comparison.header[field]).toBe(false);
      }),
    );
  });

  it("changing any one value on a line makes the document wrong, naming exactly that field", () => {
    fc.assert(
      fc.property(
        document,
        fc.nat(),
        fc.constantFrom(...SCORED_LINE_FIELDS),
        (doc, pick, field) => {
          const i = pick % doc.lines.length;
          const kind = field === "unit" ? "text" : "decimal";
          const lines = doc.lines.map((line, j) =>
            j === i ? { ...line, [field]: changed(line[field], kind) } : line,
          );
          const comparison = compareDocument({ ...doc, lines }, doc);
          expect(comparison.correct).toBe(false);
          expect(comparison.differences).toEqual([`lines.${i}.${field}`]);
        },
      ),
    );
  });

  it("changing a line's code or description, which identify it, makes the document wrong", () => {
    fc.assert(
      fc.property(
        document,
        fc.nat(),
        fc.constantFrom("supplierCode" as const, "description" as const),
        (doc, pick, field) => {
          const i = pick % doc.lines.length;
          const lines = doc.lines.map((line, j) =>
            j === i ? { ...line, [field]: changed(line[field], "text") } : line,
          );
          expect(compareDocument({ ...doc, lines }, doc).correct).toBe(false);
        },
      ),
    );
  });
});
