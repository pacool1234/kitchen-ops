import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { UnitConversion } from "./conversion";
import { averageCost, latestPurchasePrice } from "./cost";
import {
  postDocument,
  reverseDocument,
  type DeliveryNote,
  type DeliveryNoteLine,
  type Document,
  type Invoice,
  type InvoiceLine,
  type PostingResult,
} from "./document";
import { suggestBilledLines } from "./invoice";
import { parseUnitCost, unitCostFromMillionths, type UnitCost } from "./money";
import { stockOnHand, type Movement } from "./movement";

// Invoices (#115, decision 0032). A line that bills a delivery-note line at another price posts
// a receipt at the invoice's price correcting the delivery note's, plus that receipt's reversal.
// Costs count the correction where the delivery note's receipt was. A line that bills nothing is
// received like a delivery-note line.

const conversions: readonly UnitConversion[] = [
  { productId: "tomatoes", unit: "g", factor: 1 },
  { productId: "tomatoes", unit: "kg", factor: 1000 },
  { productId: "tomatoes", unit: "box", factor: 6000 },
  { productId: "eggs", unit: "unit", factor: 1000 },
  { productId: "eggs", unit: "dozen", factor: 12_000 },
];

/** A fresh ID source: `${prefix}1`, `${prefix}2`, … */
function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** Deep-freezes a value, so any attempt to change it throws. */
function deepFrozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const inner of Object.values(value)) deepFrozen(inner);
    Object.freeze(value);
  }
  return value;
}

function noteLine(
  id: string,
  productId: string,
  quantity: string,
  unit: string,
  price: string,
): DeliveryNoteLine {
  return { id, productId, quantity, unit, unitPrice: parseUnitCost(price) };
}

/** An invoice line billing `billed`, or billing nothing if it's undefined. */
function invoiceLine(
  id: string,
  billed: string | undefined,
  productId: string,
  quantity: string,
  unit: string,
  price: string,
  more: Partial<InvoiceLine> = {},
): InvoiceLine {
  return {
    ...noteLine(id, productId, quantity, unit, price),
    ...(billed === undefined ? {} : { deliveryNoteLineId: billed }),
    ...more,
  };
}

function deliveryNote(
  id: string,
  lines: DeliveryNoteLine[],
  storeroomId = "cold-room",
): DeliveryNote {
  return {
    id,
    date: "2026-10-16",
    status: "review",
    storeroomId,
    type: "delivery-note",
    supplierId: "supplier-1",
    lines,
  };
}

function invoice(
  id: string,
  lines: InvoiceLine[],
  more: Partial<Invoice> = {},
): Invoice {
  return {
    id,
    date: "2026-10-31",
    status: "review",
    storeroomId: "cold-room",
    type: "invoice",
    supplierId: "supplier-1",
    lines,
    ...more,
  };
}

function waste(id: string, productId: string, quantity: string): Document {
  return {
    id,
    date: "2026-10-17",
    status: "review",
    storeroomId: "cold-room",
    type: "waste",
    lines: [{ id: `${id}.l`, productId, quantity, unit: "kg" }],
  };
}

/** Posts a document after `movements`, with movement IDs `${document.id}.1`, `.2`, … */
function post(document: Document, movements: readonly Movement[]) {
  return postDocument(document, {
    movements,
    conversions,
    newId: counter(`${document.id}.`),
  });
}

/** Posts documents in order, each after the ones before it; fails the test if one doesn't post. */
function postAll(...documents: Document[]) {
  let movements: readonly Movement[] = [];
  const posted: Document[] = [];
  for (const document of documents) {
    const result = post(document, movements);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    movements = [...movements, ...result.movements];
    posted.push(result.document);
  }
  return { posted, movements: deepFrozen(movements) };
}

function reverse(posted: Document, movements: readonly Movement[]) {
  return reverseDocument(posted, movements, {
    id: `r-${posted.id}`,
    date: "2026-11-02",
    newId: counter(`r-${posted.id}.`),
  });
}

function movementsOf(result: PostingResult): readonly Movement[] {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.movements;
}

function errorsOf(result: PostingResult) {
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("movements");
  return result.ok ? [] : result.errors;
}

const cost = (text: string) => parseUnitCost(text);

// Before most examples: 10 kg of tomatoes at €1.80/kg (€0.0018 a gram), 6 kg of them used, then
// 4 kg more at €2.50/kg. 8 kg left at an average of (4000 × 0.0018 + 4000 × 0.0025) ÷ 8000 =
// €0.00215 a gram.
const n1 = noteLine("n1", "tomatoes", "10", "kg", "1.80");
const history = postAll(
  deliveryNote("dn1", [n1]),
  waste("w1", "tomatoes", "6"),
  deliveryNote("dn2", [noteLine("n2", "tomatoes", "4", "kg", "2.50")]),
);
const before = history.movements;

describe("postDocument: an invoice line billing a delivery-note line corrects its price", () => {
  it("the 10 kg invoiced at €2.00/kg: a receipt of 10 000 g at €0.002000 correcting the €0.001800 one, then that one's reversal; stock stays 8 kg", () => {
    const result = post(
      invoice("i1", [invoiceLine("v1", "n1", "tomatoes", "10", "kg", "2.00")]),
      before,
    );
    expect(movementsOf(result)).toEqual([
      {
        id: "i1.1",
        productId: "tomatoes",
        storeroomId: "cold-room",
        quantity: 10_000,
        unitCost: cost("0.002"),
        documentLineId: "v1",
        kind: "receipt",
        corrects: "dn1.1",
      },
      {
        id: "i1.2",
        productId: "tomatoes",
        storeroomId: "cold-room",
        quantity: -10_000,
        unitCost: cost("0.0018"),
        documentLineId: "v1",
        kind: "receipt",
        reverses: "dn1.1",
      },
    ]);
    expect(result.ok && result.document.status).toBe("posted");
    const after = [...before, ...movementsOf(result)];
    expect(stockOnHand(after, "tomatoes", "cold-room")).toBe(8000);
  });

  it("the average becomes (4000 × 0.002 + 4000 × 0.0025) ÷ 8000 = €0.002250, as if the note had said €2.00, not the €0.002000 of counting the correction last; the latest purchase price stays €2.50", () => {
    const corrected = movementsOf(
      post(
        invoice("i1", [
          invoiceLine("v1", "n1", "tomatoes", "10", "kg", "2.00"),
        ]),
        before,
      ),
    );
    const after = [...before, ...corrected];
    expect(averageCost(before, "tomatoes", "cold-room")).toBe(cost("0.00215"));
    expect(averageCost(after, "tomatoes", "cold-room")).toBe(cost("0.00225"));
    expect(latestPurchasePrice(after, "tomatoes")).toBe(cost("0.0025"));
  });

  it("correcting the latest delivery makes its new price the latest purchase price: €2.20/kg", () => {
    const corrected = movementsOf(
      post(
        invoice("i1", [invoiceLine("v1", "n2", "tomatoes", "4", "kg", "2.20")]),
        before,
      ),
    );
    expect(latestPurchasePrice([...before, ...corrected], "tomatoes")).toBe(
      cost("0.0022"),
    );
  });

  it("the same unit cost posts the invoice with no movements, also when a discount brings it there: €2.00 less 10% is €1.80", () => {
    for (const line of [
      invoiceLine("v1", "n1", "tomatoes", "10", "kg", "1.80"),
      invoiceLine("v1", "n1", "tomatoes", "10", "kg", "2.00", {
        discountPercent: "10",
      }),
    ]) {
      const result = post(invoice("i1", [line]), before);
      expect(result).toMatchObject({
        ok: true,
        document: { id: "i1", status: "posted" },
        movements: [],
      });
    }
  });

  it("an invoice over two delivery notes corrects each line in its own storeroom: 1 box billed for the dry store's 6 kg at €19.20 is €0.003200/g; the eggs at the same price post nothing", () => {
    const { movements } = postAll(
      deliveryNote("dn1", [n1]),
      deliveryNote(
        "dn3",
        [
          noteLine("n3", "eggs", "2", "dozen", "2.40"),
          noteLine("n4", "tomatoes", "6", "kg", "3.00"),
        ],
        "dry-store",
      ),
    );
    const result = post(
      invoice("i1", [
        invoiceLine("v1", "n1", "tomatoes", "10", "kg", "2.00"),
        invoiceLine("v2", "n3", "eggs", "2", "dozen", "2.40"),
        invoiceLine("v3", "n4", "tomatoes", "1", "box", "19.20"),
      ]),
      movements,
    );
    expect(movementsOf(result)).toMatchObject([
      { id: "i1.1", storeroomId: "cold-room", corrects: "dn1.1" },
      { id: "i1.2", storeroomId: "cold-room", reverses: "dn1.1" },
      {
        id: "i1.3",
        storeroomId: "dry-store",
        quantity: 6000,
        unitCost: cost("0.0032"),
        documentLineId: "v3",
        corrects: "dn3.2",
      },
      {
        id: "i1.4",
        storeroomId: "dry-store",
        quantity: -6000,
        unitCost: cost("0.003"),
        documentLineId: "v3",
        reverses: "dn3.2",
      },
    ]);
  });

  it("a rectifying invoice corrects the correction: €2.00, then €1.90 corrects the €2.00 receipt, and €0.001900 is what counts", () => {
    const first = movementsOf(
      post(
        invoice("i1", [
          invoiceLine("v1", "n1", "tomatoes", "10", "kg", "2.00"),
        ]),
        before,
      ),
    );
    const afterFirst = [...before, ...first];
    const second = movementsOf(
      post(
        invoice("i2", [
          invoiceLine("v9", "n1", "tomatoes", "10", "kg", "1.90"),
        ]),
        afterFirst,
      ),
    );
    expect(second).toMatchObject([
      { id: "i2.1", unitCost: cost("0.0019"), corrects: "i1.1" },
      { id: "i2.2", unitCost: cost("0.002"), reverses: "i1.1" },
    ]);
    // (4000 × 0.0019 + 4000 × 0.0025) ÷ 8000 = €0.0022
    expect(
      averageCost([...afterFirst, ...second], "tomatoes", "cold-room"),
    ).toBe(cost("0.0022"));
  });

  it("a returned line billed at another price: the reversal goes first, so stock never dips (−2 kg at €1.50: €0.001500)", () => {
    const { movements } = postAll(
      deliveryNote("dn1", [n1]),
      deliveryNote("dn2", [noteLine("n2", "tomatoes", "-2", "kg", "1.80")]),
    );
    expect(
      movementsOf(
        post(
          invoice("i1", [
            invoiceLine("v1", "n2", "tomatoes", "-2", "kg", "1.50"),
          ]),
          movements,
        ),
      ),
    ).toMatchObject([
      { id: "i1.2", quantity: 2000, reverses: "dn2.1" },
      {
        id: "i1.1",
        quantity: -2000,
        unitCost: cost("0.0015"),
        corrects: "dn2.1",
      },
    ]);
  });
});

describe("postDocument: an invoice line billing nothing is received like a delivery-note line", () => {
  it("2 dozen eggs at €2.40 into the dry store: the same receipt a delivery note posts, 24 000 thousandths at €0.000200", () => {
    const lines = [invoiceLine("v1", undefined, "eggs", "2", "dozen", "2.40")];
    const fromInvoice = post(
      invoice("x", lines, { storeroomId: "dry-store" }),
      before,
    );
    const fromNote = post(deliveryNote("x", lines, "dry-store"), before);
    expect(movementsOf(fromInvoice)).toEqual(movementsOf(fromNote));
    expect(movementsOf(fromInvoice)).toEqual([
      {
        id: "x.1",
        productId: "eggs",
        storeroomId: "dry-store",
        quantity: 24_000,
        unitCost: cost("0.0002"),
        documentLineId: "v1",
        kind: "receipt",
      },
    ]);
  });
});

describe("postDocument: invoice lines that can't be posted", () => {
  function failing(...lines: InvoiceLine[]) {
    return errorsOf(post(invoice("i1", lines), before));
  }

  it("a different quantity: the invoice bills 12 000 g, the delivery note received 10 000 g", () => {
    expect(
      failing(invoiceLine("v1", "n1", "tomatoes", "12", "kg", "2.00")),
    ).toEqual([
      {
        lineId: "v1",
        message: expect.stringMatching(/12000.*10000/),
      },
    ]);
  });

  it("another product than the delivery-note line received", () => {
    expect(
      failing(invoiceLine("v1", "n1", "eggs", "10", "unit", "2.00")),
    ).toEqual([
      {
        lineId: "v1",
        message: expect.stringMatching(/tomatoes.*eggs|eggs.*tomatoes/),
      },
    ]);
  });

  it("the same delivery-note line billed twice in one invoice fails on the second line, and the first posts nothing", () => {
    expect(
      failing(
        invoiceLine("v1", "n1", "tomatoes", "10", "kg", "2.00"),
        invoiceLine("v2", "n1", "tomatoes", "10", "kg", "2.00"),
      ),
    ).toEqual([
      { lineId: "v2", message: expect.stringContaining("billed twice") },
    ]);
  });

  it("a delivery-note line with no receipt in the movements given", () => {
    expect(
      failing(invoiceLine("v1", "n9", "tomatoes", "10", "kg", "2.00")),
    ).toEqual([{ lineId: "v1", message: expect.stringContaining("n9") }]);
  });

  it("a delivery note that was reversed: there's no received stock to bill", () => {
    const { posted, movements } = postAll(deliveryNote("dn1", [n1]));
    const all = [...movements, ...movementsOf(reverse(posted[0]!, movements))];
    expect(
      errorsOf(
        post(
          invoice("i1", [
            invoiceLine("v1", "n1", "tomatoes", "10", "kg", "2.00"),
          ]),
          all,
        ),
      ),
    ).toEqual([{ lineId: "v1", message: expect.stringContaining("reversed") }]);
  });

  it("every failing line is reported, and a good line among them posts nothing", () => {
    expect(
      failing(
        invoiceLine("v1", "n9", "tomatoes", "10", "kg", "2.00"),
        invoiceLine("v2", "n1", "tomatoes", "10", "kg", "2.00"),
        invoiceLine("v3", undefined, "tomatoes", "1", "crate", "2.00"),
      ).map((e) => e.lineId),
    ).toEqual(["v1", "v3"]);
  });
});

describe("reverseDocument: an invoice", () => {
  const i1 = invoice("i1", [
    invoiceLine("v1", "n1", "tomatoes", "10", "kg", "2.00"),
  ]);

  it("puts back the price it replaced: a receipt at €0.001800 correcting the €2.00 one, then that one's reversal; the average is back to €0.002150 and stock stays 8 kg", () => {
    const result = post(i1, before);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const all = deepFrozen([...before, ...result.movements]);
    const reversal = reverse(result.document, all);
    expect(reversal).toEqual({
      ok: true,
      document: {
        ...result.document,
        id: "r-i1",
        date: "2026-11-02",
        reverses: "i1",
        lines: [{ ...i1.lines[0], id: "r-i1.1" }],
      },
      movements: [
        {
          id: "r-i1.2",
          productId: "tomatoes",
          storeroomId: "cold-room",
          quantity: 10_000,
          unitCost: cost("0.0018"),
          documentLineId: "r-i1.1",
          kind: "receipt",
          corrects: "i1.1",
        },
        {
          id: "r-i1.3",
          productId: "tomatoes",
          storeroomId: "cold-room",
          quantity: -10_000,
          unitCost: cost("0.002"),
          documentLineId: "r-i1.1",
          kind: "receipt",
          reverses: "i1.1",
        },
      ],
    });
    const after = [...all, ...movementsOf(reversal)];
    expect(averageCost(after, "tomatoes", "cold-room")).toBe(cost("0.00215"));
    expect(stockOnHand(after, "tomatoes", "cold-room")).toBe(8000);
  });

  it("an invoice that corrected nothing reverses with no movements", () => {
    const result = post(
      invoice("i1", [invoiceLine("v1", "n1", "tomatoes", "10", "kg", "1.80")]),
      before,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(reverse(result.document, before)).toMatchObject({
      ok: true,
      document: { id: "r-i1", reverses: "i1" },
      movements: [],
    });
  });

  it("an invoice-only receipt is reversed like a delivery note's", () => {
    const result = post(
      invoice("i1", [
        invoiceLine("v1", undefined, "eggs", "1", "dozen", "2.40"),
      ]),
      before,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const all = [...before, ...result.movements];
    expect(movementsOf(reverse(result.document, all))).toEqual([
      expect.objectContaining({
        quantity: -12_000,
        reverses: "i1.1",
        documentLineId: "r-i1.1",
      }),
    ]);
  });

  it("reversing a delivery note after its invoice takes the goods out as they stand: the €2.00 correction is reversed, leaving no stock and no purchase", () => {
    const { posted, movements } = postAll(deliveryNote("dn1", [n1]), i1);
    const result = reverse(posted[0]!, movements);
    expect(movementsOf(result)).toEqual([
      {
        id: "r-dn1.2",
        productId: "tomatoes",
        storeroomId: "cold-room",
        quantity: -10_000,
        unitCost: cost("0.002"),
        documentLineId: "r-dn1.1",
        kind: "receipt",
        reverses: "i1.1",
      },
    ]);
    const after = [...movements, ...movementsOf(result)];
    expect(stockOnHand(after, "tomatoes", "cold-room")).toBe(0);
    expect(latestPurchasePrice(after, "tomatoes")).toBeUndefined();
  });

  it("after its invoice is reversed, a delivery note can still be reversed: its goods go out at €1.80 again", () => {
    const { posted, movements } = postAll(deliveryNote("dn1", [n1]), i1);
    const all = [...movements, ...movementsOf(reverse(posted[1]!, movements))];
    expect(movementsOf(reverse(posted[0]!, all))).toMatchObject([
      { quantity: -10_000, unitCost: cost("0.0018"), reverses: "r-i1.2" },
    ]);
  });

  it("reversing an invoice after a rectifying one puts back the price the first one replaced, €1.80, over the rectified €1.90 (the API reverses the later invoice first, decision 0032)", () => {
    const first = post(i1, before);
    if (!first.ok) throw new Error(JSON.stringify(first.errors));
    const afterFirst = [...before, ...first.movements];
    const second = movementsOf(
      post(
        invoice("i2", [
          invoiceLine("v9", "n1", "tomatoes", "10", "kg", "1.90"),
        ]),
        afterFirst,
      ),
    );
    const all = [...afterFirst, ...second];
    const undone = movementsOf(reverse(first.document, all));
    expect(undone).toMatchObject([
      { id: "r-i1.2", unitCost: cost("0.0018"), corrects: "i2.1" },
      { id: "r-i1.3", unitCost: cost("0.0019"), reverses: "i2.1" },
    ]);
    expect(averageCost([...all, ...undone], "tomatoes", "cold-room")).toBe(
      cost("0.00215"),
    );
  });
});

describe("suggestBilledLines: which delivery-note line each invoice line bills", () => {
  const notes = [
    { ...deliveryNote("dn1", [n1]), status: "posted" as const },
    {
      ...deliveryNote("dn2", [
        noteLine("n2", "eggs", "2", "dozen", "2.40"),
        noteLine("n3", "tomatoes", "6", "kg", "3.00"),
      ]),
      status: "posted" as const,
    },
  ];

  it("pairs each invoice line with its only candidate across delivery notes: same product and quantity in base units, 1 box for 6 kg", () => {
    const bill = invoice("i1", [
      invoiceLine("v1", undefined, "tomatoes", "1", "box", "19.20"),
      invoiceLine("v2", undefined, "eggs", "24", "unit", "0.20"),
      invoiceLine("v3", undefined, "tomatoes", "10000", "g", "0.002"),
      invoiceLine("v4", undefined, "eggs", "3", "dozen", "2.40"),
    ]);
    expect(suggestBilledLines(bill, notes, conversions)).toEqual([
      { invoiceLineId: "v1", deliveryNoteLineId: "n3" },
      { invoiceLineId: "v2", deliveryNoteLineId: "n2" },
      { invoiceLineId: "v3", deliveryNoteLineId: "n1" },
    ]);
  });

  it("leaves ambiguous lines for a person: two delivery-note lines of 10 kg of tomatoes, or two invoice lines for one", () => {
    const twice = [
      ...notes,
      {
        ...deliveryNote("dn3", [
          noteLine("n5", "tomatoes", "10", "kg", "1.70"),
        ]),
        status: "posted" as const,
      },
    ];
    expect(
      suggestBilledLines(
        invoice("i1", [
          invoiceLine("v1", undefined, "tomatoes", "10", "kg", "2"),
        ]),
        twice,
        conversions,
      ),
    ).toEqual([]);
    expect(
      suggestBilledLines(
        invoice("i1", [
          invoiceLine("v1", undefined, "tomatoes", "10", "kg", "2"),
          invoiceLine("v2", undefined, "tomatoes", "10", "kg", "2"),
        ]),
        notes,
        conversions,
      ),
    ).toEqual([]);
  });

  it("ignores other suppliers' notes, notes not posted, and reversals", () => {
    const others = [
      { ...notes[0]!, supplierId: "supplier-2" },
      { ...notes[0]!, status: "review" as const },
      { ...notes[0]!, reverses: "dn0" },
    ];
    expect(
      suggestBilledLines(
        invoice("i1", [
          invoiceLine("v1", undefined, "tomatoes", "10", "kg", "2"),
        ]),
        others,
        conversions,
      ),
    ).toEqual([]);
  });

  it("keeps the lines the invoice already bills, and the delivery-note lines they name, out of it", () => {
    const bill = invoice("i1", [
      invoiceLine("v1", "n1", "tomatoes", "10", "kg", "2"),
      invoiceLine("v2", undefined, "tomatoes", "10", "kg", "2"),
    ]);
    expect(suggestBilledLines(bill, notes, conversions)).toEqual([]);
  });

  it("skips an invoice line whose unit can't be converted, instead of failing", () => {
    const bill = invoice("i1", [
      invoiceLine("v1", undefined, "tomatoes", "1", "crate", "2"),
      invoiceLine("v2", undefined, "eggs", "2", "dozen", "2.40"),
    ]);
    expect(suggestBilledLines(bill, notes, conversions)).toEqual([
      { invoiceLineId: "v2", deliveryNoteLineId: "n2" },
    ]);
  });
});

// Properties. A history of delivery notes and waste is posted in order, skipping documents that
// fail; then an invoice bills some of the posted delivery-note lines, each at its own price or a
// new one, and may receive a few lines of its own. "As if" is the same history posted with the
// invoice's prices on the delivery notes, plus the invoice's own lines received at the end.

const PRODUCTS = ["tomatoes", "eggs"] as const;
const STOREROOMS = ["cold-room", "dry-store"] as const;
const UNIT = { tomatoes: "kg", eggs: "dozen" } as const;
const everyLocation = PRODUCTS.flatMap((p) =>
  STOREROOMS.map((s) => [p, s] as const),
);

/** Per kg or dozen: up to €100. */
const price = fc
  .bigInt({ min: 0n, max: 10n ** 8n })
  .map(unitCostFromMillionths);
const product = fc.constantFrom(...PRODUCTS);
const storeroom = fc.constantFrom(...STOREROOMS);

const historyStep = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant("delivery-note" as const),
      storeroomId: storeroom,
      lines: fc.array(
        fc.record({
          productId: product,
          // Mostly deliveries, sometimes a return.
          quantity: fc.integer({ min: -3, max: 20 }).filter((q) => q !== 0),
          price,
        }),
        { minLength: 1, maxLength: 3 },
      ),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant("waste" as const),
      storeroomId: storeroom,
      productId: product,
      quantity: fc.integer({ min: 1, max: 20 }),
    }),
  },
);
type HistoryStep = typeof historyStep extends fc.Arbitrary<infer T> ? T : never;

/** Posts the history, with each delivery-note line's price from `priceOf`; skips failing documents. */
function postHistory(
  steps: readonly HistoryStep[],
  priceOf: (lineId: string, price: UnitCost) => UnitCost,
) {
  let movements: readonly Movement[] = [];
  const notes: DeliveryNote[] = [];
  steps.forEach((step, i) => {
    const id = `h${i}`;
    const document: Document =
      step.type === "waste"
        ? {
            id,
            date: "2026-10-17",
            status: "review",
            storeroomId: step.storeroomId,
            type: "waste",
            lines: [
              {
                id: `${id}.l0`,
                productId: step.productId,
                quantity: String(step.quantity),
                unit: UNIT[step.productId],
              },
            ],
          }
        : deliveryNote(
            id,
            step.lines.map((l, j) => ({
              id: `${id}.l${j}`,
              productId: l.productId,
              quantity: String(l.quantity),
              unit: UNIT[l.productId],
              unitPrice: priceOf(`${id}.l${j}`, l.price),
            })),
            step.storeroomId,
          );
    const result = post(document, movements);
    if (!result.ok) return;
    movements = [...movements, ...result.movements];
    if (result.document.type === "delivery-note") notes.push(result.document);
  });
  return { movements: deepFrozen(movements), notes };
}

const scenarioArb = fc
  .record({
    steps: fc.array(historyStep, { minLength: 1, maxLength: 8 }),
    // Which delivery-note lines the invoice bills (indexes, wrapped), and at what price: none
    // means the delivery note's own.
    billed: fc.array(
      fc.record({ pick: fc.nat(), price: fc.option(price, { freq: 3 }) }),
      { maxLength: 6 },
    ),
    own: fc.array(
      fc.record({
        productId: product,
        quantity: fc.integer({ min: 1, max: 20 }),
        price,
      }),
      { maxLength: 2 },
    ),
    storeroomId: storeroom,
  })
  .map(({ steps, billed, own, storeroomId }) => {
    const posted = postHistory(steps, (_, p) => p);
    const noteLines = posted.notes.flatMap((n) => n.lines);
    const newPrices = new Map<string, UnitCost>();
    const billing: InvoiceLine[] = [];
    for (const { pick, price: newPrice } of billed) {
      if (noteLines.length === 0) break;
      const line = noteLines[pick % noteLines.length]!;
      if (newPrices.has(line.id)) continue;
      const unitPrice = newPrice ?? line.unitPrice;
      newPrices.set(line.id, unitPrice);
      billing.push({
        id: `v${billing.length}`,
        deliveryNoteLineId: line.id,
        productId: line.productId,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice,
      });
    }
    const ownLines: InvoiceLine[] = own.map((l, k) => ({
      id: `u${k}`,
      productId: l.productId,
      quantity: String(l.quantity),
      unit: UNIT[l.productId],
      unitPrice: l.price,
    }));
    const asIfHistory = postHistory(steps, (id, p) => newPrices.get(id) ?? p);
    let asIf = asIfHistory.movements;
    if (ownLines.length > 0) {
      asIf = [
        ...asIf,
        ...movementsOf(post(deliveryNote("own", ownLines, storeroomId), asIf)),
      ];
    }
    return {
      before: posted.movements,
      notes: posted.notes,
      billing,
      ownLines,
      storeroomId,
      asIf,
    };
  });
type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never;

function invoiceOf(
  { billing, ownLines, storeroomId }: Scenario,
  { own = true } = {},
): Invoice {
  return invoice("i1", [...billing, ...(own ? ownLines : [])], { storeroomId });
}

/** Every location's average cost, and each product's latest purchase price. */
function costs(movements: readonly Movement[]) {
  return {
    averages: everyLocation.map(([p, s]) => averageCost(movements, p, s)),
    latest: PRODUCTS.map((p) => latestPurchasePrice(movements, p)),
  };
}

function stocks(movements: readonly Movement[]) {
  return everyLocation.map(([p, s]) => stockOnHand(movements, p, s));
}

describe("invoice properties", () => {
  it("an invoice that only bills delivery-note lines never changes stock on hand, for any product or storeroom", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { before } = scenario;
        if (scenario.billing.length === 0) return;
        const added = movementsOf(
          post(invoiceOf(scenario, { own: false }), before),
        );
        expect(stocks([...before, ...added])).toEqual(stocks(before));
      }),
    );
  });

  it("after an invoice, every average cost and latest purchase price is exactly what it would be had its delivery notes shown its prices, and its own lines been received last", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { before, asIf } = scenario;
        if (scenario.billing.length + scenario.ownLines.length === 0) return;
        const added = movementsOf(post(invoiceOf(scenario), before));
        expect(costs([...before, ...added])).toEqual(costs(asIf));
      }),
    );
  });

  it("an invoice whose prices are its delivery notes' posts no movements", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        if (scenario.billing.length === 0) return;
        const notePrices = new Map(
          scenario.notes
            .flatMap((n) => n.lines)
            .map((l) => [l.id, l.unitPrice]),
        );
        const samePrices = scenario.billing.map((l) => ({
          ...l,
          unitPrice: notePrices.get(l.deliveryNoteLineId!)!,
        }));
        const result = post(invoice("i1", samePrices), scenario.before);
        expect(movementsOf(result)).toEqual([]);
      }),
    );
  });

  it("while an invoice posts, no stock ever goes below what it was before the invoice", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { before } = scenario;
        if (scenario.billing.length + scenario.ownLines.length === 0) return;
        const added = movementsOf(post(invoiceOf(scenario), before));
        const floor = stocks(before);
        added.forEach((_, i) => {
          const now = stocks([...before, ...added.slice(0, i + 1)]);
          now.forEach((q, j) => expect(q).toBeGreaterThanOrEqual(floor[j]!));
        });
      }),
    );
  });

  it("an invoice's own lines post exactly the receipts a delivery note with the same lines posts", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { ownLines, storeroomId, before } = scenario;
        if (ownLines.length === 0) return;
        expect(
          post(invoice("x", ownLines, { storeroomId }), before),
        ).toMatchObject({
          movements: movementsOf(
            post(deliveryNote("x", ownLines, storeroomId), before),
          ),
        });
      }),
    );
  });

  it("reversing an invoice right after posting it brings back every stock, average cost and latest purchase price", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { before } = scenario;
        if (scenario.billing.length + scenario.ownLines.length === 0) return;
        const result = post(invoiceOf(scenario), before);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        const all = [...before, ...result.movements];
        const after = [...all, ...movementsOf(reverse(result.document, all))];
        expect(costs(after)).toEqual(costs(before));
        expect(stocks(after)).toEqual(stocks(before));
      }),
    );
  });

  it("invariant 2: every movement from posting or reversing an invoice points to a line of the invoice returned with it", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { before } = scenario;
        if (scenario.billing.length + scenario.ownLines.length === 0) return;
        const result = post(invoiceOf(scenario), before);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        const reversal = reverse(result.document, [
          ...before,
          ...result.movements,
        ]);
        for (const r of [result, reversal]) {
          if (!r.ok) throw new Error(JSON.stringify(r.errors));
          const lineIds = new Set(r.document.lines.map((l) => l.id));
          for (const m of r.movements) {
            expect(lineIds.has(m.documentLineId)).toBe(true);
          }
        }
      }),
    );
  });

  it("invariant 3: an invoice changes no movement; it only reverses existing receipts and posts new ones, each correction paired with the reversal of the receipt it corrects", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { before } = scenario;
        const copy = structuredClone(before);
        if (scenario.billing.length + scenario.ownLines.length === 0) return;
        const added = movementsOf(post(invoiceOf(scenario), before));
        expect(before).toEqual(copy);
        const ids = new Set(before.map((m) => m.id));
        for (const m of added) {
          expect(ids.has(m.id)).toBe(false);
          expect(m.kind).toBe("receipt");
          const replaced = m.reverses ?? m.corrects;
          if (replaced === undefined) continue;
          expect(ids.has(replaced)).toBe(true);
          const partner = added.find((other) =>
            m.reverses === undefined
              ? other.reverses === replaced
              : other.corrects === replaced,
          );
          expect(partner).toMatchObject({
            productId: m.productId,
            storeroomId: m.storeroomId,
            quantity: 0 - m.quantity,
            documentLineId: m.documentLineId,
          });
        }
      }),
    );
  });

  it("invariant 4: an invoice with any failing line posts no movements and names every failing line; one line billing an unknown delivery-note line anywhere is enough", () => {
    fc.assert(
      fc.property(scenarioArb, fc.nat(), (scenario, at) => {
        const lines = [...invoiceOf(scenario).lines];
        lines.splice(
          at % (lines.length + 1),
          0,
          invoiceLine("broken", "no-such-line", "tomatoes", "1", "kg", "1"),
        );
        const errors = errorsOf(post(invoice("i1", lines), scenario.before));
        expect(errors.map((e) => e.lineId)).toEqual(["broken"]);
      }),
    );
  });

  it("invariant 5 (cost): with invoice corrections among them, replaying the same movements in the same order gives the same average costs and latest purchase prices, also from a fresh copy", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { before } = scenario;
        const result = post(invoiceOf(scenario), before);
        if (!result.ok) return;
        const all = [...before, ...result.movements];
        const first = costs(all);
        expect(costs(all)).toEqual(first);
        expect(costs(structuredClone(all))).toEqual(first);
      }),
    );
  });

  it("invariant 7: posting or reversing an invoice never changes the invoice or the movements given", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        if (scenario.billing.length + scenario.ownLines.length === 0) return;
        const bill = deepFrozen(invoiceOf(scenario));
        const copy = structuredClone(bill);
        const result = post(bill, scenario.before);
        expect(bill).toEqual(copy);
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        const posted = deepFrozen(result.document);
        const all = deepFrozen([...scenario.before, ...result.movements]);
        const both = structuredClone({ posted, all });
        reverse(posted, all);
        expect({ posted, all }).toEqual(both);
      }),
    );
  });

  it("suggested pairs always have the same product and quantity in base units, and no invoice or delivery-note line is used twice", () => {
    fc.assert(
      fc.property(
        scenarioArb,
        fc.array(
          fc.record({
            pick: fc.nat(),
            unit: fc.constantFrom("g", "kg", "box", "unit", "dozen"),
          }),
          {
            maxLength: 6,
          },
        ),
        (scenario, picks) => {
          const noteLines = scenario.notes.flatMap((n) => n.lines);
          if (noteLines.length === 0) return;
          // Invoice lines copied from delivery-note lines, some in another unit, so that some
          // match, some don't, and some are ambiguous.
          const lines = picks.map(({ pick, unit }, k) => {
            const l = noteLines[pick % noteLines.length]!;
            return invoiceLine(
              `v${k}`,
              undefined,
              l.productId,
              l.quantity,
              unit,
              "1",
            );
          });
          const bill = invoice("i1", lines);
          const posted = scenario.notes.map((n) => ({
            ...n,
            status: "posted" as const,
          }));
          const suggested = suggestBilledLines(bill, posted, conversions);
          const byId = new Map(noteLines.map((l) => [l.id, l]));
          const base = (l: {
            productId: string;
            quantity: string;
            unit: string;
          }) =>
            conversions.find(
              (c) => c.productId === l.productId && c.unit === l.unit,
            )?.factor;
          for (const { invoiceLineId, deliveryNoteLineId } of suggested) {
            const v = lines.find((l) => l.id === invoiceLineId)!;
            const n = byId.get(deliveryNoteLineId)!;
            expect(v.productId).toBe(n.productId);
            expect(Number(v.quantity) * base(v)!).toBe(
              Number(n.quantity) * base(n)!,
            );
          }
          const used = (key: "invoiceLineId" | "deliveryNoteLineId") =>
            new Set(suggested.map((s) => s[key])).size;
          expect(used("invoiceLineId")).toBe(suggested.length);
          expect(used("deliveryNoteLineId")).toBe(suggested.length);
        },
      ),
    );
  });
});
