import {
  ExtractedDocument,
  fieldErrors,
  type ExtractedLine,
} from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  editing,
  emptyLine,
  readDate,
  reviewPaths,
  toDraft,
  toValues,
  writeDate,
} from "./draft-form";

// The review form's values (#118): the draft as its fields hold it, and back, so a draft
// nobody touched is sent back as it came; dates typed the Spanish way; where each check's
// failure shows; and who may change what (spec section 6, decision 0037).

const digits = (maxLength: number) =>
  fc.string({ unit: fc.constantFrom(..."0123456789"), maxLength });
const decimal = (decimals: number) =>
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
const text = fc.string({
  unit: fc.constantFrom(..."abcñáXYZ019 -/.,"),
  minLength: 1,
  maxLength: 20,
});
const isoDate = fc
  .integer({ min: Date.UTC(1900, 0, 1), max: Date.UTC(2100, 11, 31) })
  .map((ms) => new Date(ms).toISOString().slice(0, 10));
const nullable = <T>(value: fc.Arbitrary<T>) => fc.option(value, { nil: null });

const line: fc.Arbitrary<ExtractedLine> = fc.record({
  supplierCode: nullable(text),
  description: nullable(text),
  quantity: nullable(decimal(6)),
  unit: nullable(text),
  unitPrice: nullable(decimal(6)),
  discountPercent: nullable(percentage),
  vatRate: nullable(percentage),
  lineTotal: nullable(decimal(2)),
});

/** Any draft the schema takes, nulls included. */
const draft: fc.Arbitrary<ExtractedDocument> = fc
  .record({
    documentType: fc.constantFrom("delivery-note" as const, "invoice" as const),
    currency: fc.constant("EUR" as const),
    supplier: fc.record({
      name: nullable(text),
      taxId: nullable(fc.stringMatching(/^[A-Z0-9]{1,11}$/)),
    }),
    number: nullable(text),
    issueDate: nullable(isoDate),
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
    lines: fc.array(line, { minLength: 1, maxLength: 5 }),
  })
  .filter((d) => ExtractedDocument.safeParse(d).success);

describe("the form's values: a draft as its fields hold it, and back", () => {
  it("any draft, turned into the form's values and back, is the same draft", () => {
    fc.assert(
      fc.property(draft, (read) => {
        expect(toDraft(toValues(read))).toEqual(read);
      }),
    );
  });

  it("a field left empty, or only spaces, is null: not printed", () => {
    const values = toValues(null);
    values.number = "   ";
    values.supplier.name = "";
    values.lines[0]!.quantity = "";
    const sent = toDraft(values);
    expect(sent.number).toBeNull();
    expect(sent.supplier.name).toBeNull();
    expect(sent.lines[0]!.quantity).toBeNull();
  });

  it("nothing read: a delivery note without prices, with one empty line to fill in", () => {
    const values = toValues(null);
    expect(values.documentType).toBe("delivery-note");
    expect(values.hasTotals).toBe(false);
    expect(values.lines).toEqual([emptyLine()]);
    expect(toDraft(values).totals).toBeNull();
    expect(toDraft(values).lines).toEqual([
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
    ]);
  });

  it("a tax ID is sent as the schema takes it: capitals, without spaces, dots or hyphens", () => {
    const values = toValues(null);
    values.supplier.taxId = " b-12.345 678 ";
    expect(toDraft(values).supplier.taxId).toBe("B12345678");
    values.supplier.taxId = "es b12345678";
    expect(toDraft(values).supplier.taxId).toBe("ESB12345678");
  });

  it("totals switched off are null; switched on again, they're as they were", () => {
    const values = toValues(null);
    values.hasTotals = true;
    values.totals.net = "10";
    expect(toDraft(values).totals).toEqual({ net: "10", vat: [], total: null });
    values.hasTotals = false;
    expect(toDraft(values).totals).toBeNull();
    values.hasTotals = true;
    expect(toDraft(values).totals?.net).toBe("10");
  });

  it("a date that can't be read is sent as typed, so the schema refuses it on its field", () => {
    const values = toValues(null);
    values.issueDate = "31/02/2026";
    const sent = toDraft(values);
    const parsed = ExtractedDocument.safeParse(sent);
    expect(parsed.success).toBe(false);
    expect(fieldErrors(parsed.error!.issues, sent)).toEqual({
      issueDate: "invalid",
    });
  });
});

describe("dates, typed as dd/mm/aaaa", () => {
  it("any date written by writeDate is read back as the same date", () => {
    fc.assert(
      fc.property(isoDate, (date) => {
        expect(readDate(writeDate(date))).toEqual({ ok: true, value: date });
      }),
    );
  });

  it("reads a day and month of one or two digits, with /, - or . between them", () => {
    for (const typed of [
      "20/10/2026",
      "20-10-2026",
      "20.10.2026",
      " 20/10/2026 ",
    ]) {
      expect(readDate(typed)).toEqual({ ok: true, value: "2026-10-20" });
    }
    expect(readDate("1/2/2026")).toEqual({ ok: true, value: "2026-02-01" });
    expect(writeDate("2026-02-01")).toBe("01/02/2026");
  });

  it("empty is no date; a day that doesn't exist, or any other way of writing one, is refused", () => {
    expect(readDate("")).toEqual({ ok: true, value: null });
    expect(writeDate(null)).toBe("");
    for (const typed of [
      "31/02/2026",
      "29/02/2025",
      "00/10/2026",
      "20/13/2026",
      "2026-10-20",
      "20/10/26",
      "10/20/2026",
      "hoy",
    ]) {
      expect(readDate(typed), typed).toEqual({ ok: false });
    }
    expect(readDate("29/02/2024")).toEqual({ ok: true, value: "2024-02-29" });
  });
});

describe("where a failure shows: every field a check names is on the form", () => {
  it("each path the checks name, on a draft with that line or VAT row, is a field or a block of the form", () => {
    // The paths in packages/extract/src/validation/checks.ts.
    const named = (line: number, row: number) => [
      "supplier.taxId",
      "number",
      "issueDate",
      "totals",
      "totals.net",
      "totals.total",
      "totals.vat",
      `totals.vat.${row}.rate`,
      `totals.vat.${row}.base`,
      `totals.vat.${row}.amount`,
      ...[
        "description",
        "quantity",
        "unit",
        "unitPrice",
        "vatRate",
        "lineTotal",
      ].map((field) => `lines.${line}.${field}`),
    ];
    fc.assert(
      fc.property(
        draft.filter((d) => d.totals !== null && d.totals.vat.length > 0),
        (read) => {
          const paths = reviewPaths(toValues(read));
          const line = read.lines.length - 1;
          const row = read.totals!.vat.length - 1;
          for (const path of named(line, row)) {
            expect(paths, path).toContain(path);
          }
        },
      ),
    );
  });

  it("no path for a line or a VAT row that isn't there", () => {
    const values = toValues(null);
    const paths = reviewPaths(values);
    expect(paths).toContain("lines.0.quantity");
    expect(paths).not.toContain("lines.1.quantity");
    expect(paths.some((p) => p.startsWith("totals.vat."))).toBe(false);
  });
});

describe("who may change what (spec section 6, decision 0037)", () => {
  it("office and owner: everything, read or not, a delivery note or an invoice", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("office" as const, "owner" as const),
        nullable(draft),
        (role, read) => {
          expect(editing(role, read)).toBe("all");
        },
      ),
    );
  });

  it("a counter user: a delivery note's quantities, and nothing of an invoice or of a document nothing was read of", () => {
    fc.assert(
      fc.property(draft, (read) => {
        expect(editing("counter", read)).toBe(
          read.documentType === "delivery-note" ? "quantities" : "none",
        );
      }),
    );
    expect(editing("counter", null)).toBe("none");
  });
});
