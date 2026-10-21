import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  formatMoney,
  lineTotal,
  moneyFromCents,
  parseMoney,
  parseUnitCost,
  percentageOf,
} from "@kitchen-ops/ledger";
import type { ExtractedDocument, ExtractedLine } from "@kitchen-ops/shared";
import { validate, type ValidationContext } from "./checks";

// A fictional invoice that adds up, worked out by hand:
//   2 × 38.50 = 77.00, less 5% = 73.15 (10% VAT)
//   10 × 3.20 = 32.00 (10% VAT)
//   1 × 18.75 = 18.75, less 10% = 16.875 → 16.88, a half cent away from zero (10% VAT)
//   3 × 12.40 = 37.20, less 5% = 35.34 (21% VAT)
//   net 73.15 + 32.00 + 16.88 + 35.34 = 157.37
//   VAT 10% on 122.03 = 12.203 → 12.20; 21% on 35.34 = 7.4214 → 7.42; total 157.37 + 19.62 = 176.99
function priced(
  quantity: string,
  unitPrice: string,
  discountPercent: string | null,
  vatRate: string,
  total: string,
): ExtractedLine {
  return {
    supplierCode: null,
    description: "Producto",
    quantity,
    unit: "ud",
    unitPrice,
    discountPercent,
    vatRate,
    lineTotal: total,
  };
}

const invoice: ExtractedDocument = {
  documentType: "invoice",
  currency: "EUR",
  supplier: { name: "Proveedor Ficticio S.A.", taxId: "B00123455" },
  number: "F-1",
  issueDate: "2026-10-15",
  deliveryNotes: [],
  totals: {
    net: "157.37",
    vat: [
      { rate: "10", base: "122.03", amount: "12.20" },
      { rate: "21", base: "35.34", amount: "7.42" },
    ],
    total: "176.99",
  },
  lines: [
    priced("2", "38.50", "5", "10", "73.15"),
    priced("10", "3.20", null, "10", "32.00"),
    priced("1", "18.75", "10", "10", "16.88"),
    priced("3", "12.40", "5", "21", "35.34"),
  ],
};

const context: ValidationContext = {
  today: "2026-10-16",
  maxAgeDays: 365,
  knownNumbers: [],
};

/** The failing checks and paths, without messages. */
function failures(document: ExtractedDocument, ctx = context) {
  return validate(document, ctx).failures.map((f) => `${f.check} ${f.path}`);
}

/** Whether the duplicate check flags `number` when `known` was already received. */
function isDuplicate(number: string, known: string): boolean {
  return validate(
    { ...invoice, number },
    { ...context, knownNumbers: [known] },
  ).failures.some((f) => f.check === "duplicate");
}

describe("validate: a result that adds up", () => {
  it("the hand-worked invoice passes every check", () => {
    expect(validate(invoice, context)).toEqual({ passed: true, failures: [] });
  });

  it("a delivery note without prices skips every price check", () => {
    const note: ExtractedDocument = {
      ...invoice,
      documentType: "delivery-note",
      totals: null,
      lines: [
        {
          ...priced("2", "1.00", null, "10", "2.00"),
          unitPrice: null,
          vatRate: null,
          lineTotal: null,
        },
      ],
    };
    expect(failures(note)).toEqual([]);
  });
});

describe("validate: each check, failing", () => {
  it("line-total: 2 × 38.50 less 5% is 73.15, not 73.16; the message shows the working", () => {
    const wrong = {
      ...invoice,
      lines: [
        { ...invoice.lines[0]!, lineTotal: "73.16" },
        ...invoice.lines.slice(1),
      ],
    };
    const result = validate(wrong, context);
    expect(result.passed).toBe(false);
    expect(result.failures).toContainEqual({
      check: "line-total",
      path: "lines.0.lineTotal",
      message: "2 × 38.50 less 5% is 73.15, but the line says 73.16",
    });
  });

  it("lines-sum: the line totals add up to 157.37, not the 157.38 printed", () => {
    const wrong = { ...invoice, totals: { ...invoice.totals!, net: "157.38" } };
    expect(failures(wrong)).toContain("lines-sum totals.net");
  });

  it("vat: a base that isn't the sum of its lines' totals (122.04 instead of 122.03)", () => {
    const vat = [
      { ...invoice.totals!.vat[0]!, base: "122.04" },
      invoice.totals!.vat[1]!,
    ];
    expect(
      failures({ ...invoice, totals: { ...invoice.totals!, vat } }),
    ).toContain("vat totals.vat.0.base");
  });

  it("vat: 10% of 122.03 is 12.20 on the base, or 7.32 + 3.20 + 1.69 = 12.21 line by line; 12.22 is neither", () => {
    const withAmount = (amount: string) => {
      const vat = [
        { ...invoice.totals!.vat[0]!, amount },
        invoice.totals!.vat[1]!,
      ];
      // Keep the total consistent, so only the VAT check can fail.
      const total = formatMoney(
        moneyFromCents(
          parseMoney("157.37") + parseMoney(amount) + parseMoney("7.42"),
        ),
      );
      return failures({
        ...invoice,
        totals: { ...invoice.totals!, vat, total },
      });
    };
    expect(withAmount("12.20")).toEqual([]);
    expect(withAmount("12.21")).toEqual([]);
    expect(withAmount("12.22")).toEqual(["vat totals.vat.0.amount"]);
  });

  it("vat: the message shows both ways of working it out", () => {
    const vat = [
      { ...invoice.totals!.vat[0]!, amount: "12.22" },
      invoice.totals!.vat[1]!,
    ];
    expect(
      validate({ ...invoice, totals: { ...invoice.totals!, vat } }, context)
        .failures,
    ).toContainEqual({
      check: "vat",
      path: "totals.vat.0.amount",
      message:
        "10% of 122.03 is 12.20 (12.21 line by line), but the amount says 12.22",
    });
  });

  it("vat: both Spanish conventions are accepted. Two lines of 0.05 at 10%: 0.01 on the base, or 0.01 + 0.01 = 0.02 line by line; 0.03 is neither", () => {
    const small = (amount: string, total: string): ExtractedDocument => ({
      ...invoice,
      totals: {
        net: "0.10",
        vat: [{ rate: "10", base: "0.10", amount }],
        total,
      },
      lines: [
        priced("1", "0.05", null, "10", "0.05"),
        priced("1", "0.05", null, "10", "0.05"),
      ],
    });
    expect(failures(small("0.01", "0.11"))).toEqual([]);
    expect(failures(small("0.02", "0.12"))).toEqual([]);
    expect(failures(small("0.03", "0.13"))).toEqual([
      "vat totals.vat.0.amount",
    ]);
  });

  it("total: 157.37 + 12.20 + 7.42 is 176.99, not 177.00", () => {
    const wrong = {
      ...invoice,
      totals: { ...invoice.totals!, total: "177.00" },
    };
    expect(failures(wrong)).toEqual(["total totals.total"]);
  });

  it("tax-id: a CIF with the wrong control digit, or a foreign tax ID", () => {
    expect(
      failures({
        ...invoice,
        supplier: { ...invoice.supplier, taxId: "B00123456" },
      }),
    ).toEqual(["tax-id supplier.taxId"]);
    expect(
      failures({
        ...invoice,
        supplier: { ...invoice.supplier, taxId: "FR12345678901" },
      }),
    ).toEqual(["tax-id supplier.taxId"]);
  });

  it("date: after today, or more than maxAgeDays before it; today itself and exactly maxAgeDays ago pass", () => {
    const dated = (issueDate: string) => failures({ ...invoice, issueDate });
    expect(dated("2026-10-17")).toEqual(["date issueDate"]);
    expect(dated("2025-10-15")).toEqual(["date issueDate"]); // 366 days before 2026-10-16
    expect(dated("2026-10-16")).toEqual([]);
    expect(dated("2025-10-16")).toEqual([]); // exactly 365 days
  });

  it("duplicate: a number already known for this supplier, ignoring case and spaces", () => {
    expect(failures(invoice, { ...context, knownNumbers: ["f - 1"] })).toEqual([
      "duplicate number",
    ]);
    expect(failures(invoice, { ...context, knownNumbers: ["F-2"] })).toEqual(
      [],
    );
  });

  it("duplicate: the separators -, / and . don't count either, so a PDF and a Facturae copy of one invoice match", () => {
    for (const known of ["LI26-0482", "LI26/0482", "li26 0482", "LI26.0482"]) {
      expect(isDuplicate("LI260482", known), known).toBe(true);
    }
  });

  it("duplicate: numbers without separators are compared exactly, so F1, F10 and F01 are three numbers", () => {
    expect(isDuplicate("F1", "F10")).toBe(false);
    expect(isDuplicate("F1", "F01")).toBe(false);
    expect(isDuplicate("F10", "F01")).toBe(false);
    expect(isDuplicate("F10", "f10")).toBe(true);
  });

  it("duplicate: only spaces, -, / and . are ignored; any other character still counts, so F_1, F#1 and F1 are three numbers", () => {
    expect(isDuplicate("F_1", "F1")).toBe(false);
    expect(isDuplicate("F#1", "F1")).toBe(false);
    expect(isDuplicate("F_1", "F#1")).toBe(false);
  });

  it("missing-value: on every document, the tax ID, number, date, and each line's quantity, unit and a description or code", () => {
    const missing: ExtractedDocument = {
      ...invoice,
      documentType: "delivery-note",
      supplier: { name: null, taxId: null },
      number: null,
      issueDate: null,
      totals: null,
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
    expect(failures(missing)).toEqual([
      "missing-value supplier.taxId",
      "missing-value number",
      "missing-value issueDate",
      "missing-value lines.0.quantity",
      "missing-value lines.0.unit",
      "missing-value lines.0.description",
    ]);
  });

  it("missing-value: an invoice also needs its totals, and each line's price, VAT rate and total", () => {
    const missing: ExtractedDocument = {
      ...invoice,
      totals: null,
      lines: [
        {
          ...invoice.lines[0]!,
          unitPrice: null,
          vatRate: null,
          lineTotal: null,
        },
      ],
    };
    expect(failures(missing)).toEqual([
      "missing-value totals",
      "missing-value lines.0.unitPrice",
      "missing-value lines.0.vatRate",
      "missing-value lines.0.lineTotal",
    ]);
  });
});

// Any invoice that adds up: 1 to 6 lines, line totals from the ledger's lineTotal, VAT per rate
// from percentageOf, net and total from the sums.
const addsUp = fc
  .array(
    fc.record({
      quantity: fc.oneof(
        fc.integer({ min: -50, max: 500 }).map(String),
        fc.integer({ min: 1, max: 99_999 }).map((n) => (n / 1000).toFixed(3)),
      ),
      unitPrice: fc
        .integer({ min: 0, max: 99_999 })
        .map((n) => (n / 100).toFixed(2)),
      discountPercent: fc.constantFrom(null, "5", "10", "12.5"),
      vatRate: fc.constantFrom("4", "10", "21"),
    }),
    { minLength: 1, maxLength: 6 },
  )
  .map((rows): ExtractedDocument => {
    const lines = rows.map((r) =>
      priced(
        r.quantity,
        r.unitPrice,
        r.discountPercent,
        r.vatRate,
        formatMoney(
          lineTotal({
            quantity: r.quantity,
            unitPrice: parseUnitCost(r.unitPrice),
            ...(r.discountPercent === null
              ? {}
              : { discountPercent: r.discountPercent }),
          }),
        ),
      ),
    );
    const bases = new Map<string, bigint>();
    for (const l of lines) {
      bases.set(
        l.vatRate!,
        (bases.get(l.vatRate!) ?? 0n) + parseMoney(l.lineTotal!),
      );
    }
    const vat = [...bases].map(([rate, base]) => ({
      rate,
      base: formatMoney(moneyFromCents(base)),
      amount: formatMoney(percentageOf(moneyFromCents(base), rate)),
    }));
    const net = [...bases.values()].reduce((a, b) => a + b, 0n);
    const total = vat.reduce((sum, v) => sum + parseMoney(v.amount), net);
    return {
      ...invoice,
      totals: {
        net: formatMoney(moneyFromCents(net)),
        vat,
        total: formatMoney(moneyFromCents(total)),
      },
      lines,
    };
  });

/** Every amount in a result, as a way to change exactly one of them. */
function withOneAmountChanged(
  document: ExtractedDocument,
  pick: number,
  cents: bigint,
): ExtractedDocument {
  const shift = (s: string) =>
    formatMoney(moneyFromCents(parseMoney(s) + cents));
  const totals = document.totals!;
  const editors: (() => ExtractedDocument)[] = [
    ...document.lines.map((_, i) => () => ({
      ...document,
      lines: document.lines.map((l, j) =>
        j === i ? { ...l, lineTotal: shift(l.lineTotal!) } : l,
      ),
    })),
    () => ({ ...document, totals: { ...totals, net: shift(totals.net!) } }),
    ...totals.vat.flatMap((v, i) => [
      () => ({
        ...document,
        totals: {
          ...totals,
          vat: totals.vat.map((w, j) =>
            j === i ? { ...w, base: shift(v.base!) } : w,
          ),
        },
      }),
      () => ({
        ...document,
        totals: {
          ...totals,
          vat: totals.vat.map((w, j) =>
            j === i ? { ...w, amount: shift(v.amount!) } : w,
          ),
        },
      }),
    ]),
    () => ({ ...document, totals: { ...totals, total: shift(totals.total!) } }),
  ];
  return editors[pick % editors.length]!();
}

describe("validation properties", () => {
  it("a result built to add up passes every arithmetic check", () => {
    fc.assert(
      fc.property(addsUp, (document) => {
        expect(failures(document)).toEqual([]);
      }),
    );
  });

  it("changing any one amount by one cent (a line total, the net, a VAT base or amount, the total) fails at least one check", () => {
    fc.assert(
      fc.property(
        addsUp,
        fc.nat(),
        fc.constantFrom(1n, -1n),
        (document, pick, cents) => {
          const changed = withOneAmountChanged(document, pick, cents);
          expect(validate(changed, context).passed).toBe(false);
        },
      ),
    );
  });
});

describe("duplicate: document numbers, properties", () => {
  const SEPARATORS = ["-", "/", ".", " "];
  const core = fc.string({
    unit: fc.constantFrom(..."aAbB019"),
    minLength: 1,
    maxLength: 8,
  });
  const anyNumber = fc.string({
    unit: fc.constantFrom(..."aAbB019", ...SEPARATORS),
    minLength: 1,
    maxLength: 10,
  });
  const insertions = fc.array(
    fc.tuple(fc.nat(), fc.constantFrom(...SEPARATORS)),
    { maxLength: 4 },
  );
  /** `value` with separators inserted at the given positions. */
  const insert = (value: string, at: readonly [number, string][]) =>
    at.reduce((text, [position, separator]) => {
      const i = position % (text.length + 1);
      return text.slice(0, i) + separator + text.slice(i);
    }, value);
  const strip = (value: string) => value.replace(/[-/. ]/g, "");

  it("inserting separators anywhere, in either number, never makes it a different number", () => {
    fc.assert(
      fc.property(core, insertions, insertions, (number, a, b) => {
        expect(isDuplicate(insert(number, a), insert(number, b))).toBe(true);
      }),
    );
  });

  it("removing separators never changes whether two numbers are the same", () => {
    fc.assert(
      fc.property(anyNumber, anyNumber, (a, b) => {
        expect(isDuplicate(strip(a), strip(b))).toBe(isDuplicate(a, b));
      }),
    );
  });

  it("numbers of only letters and digits are the same exactly when their text is, ignoring case", () => {
    fc.assert(
      fc.property(core, core, (a, b) => {
        expect(isDuplicate(a, b)).toBe(a.toUpperCase() === b.toUpperCase());
      }),
    );
  });
});
