import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { toBaseUnits, type UnitConversion } from "./conversion";
import {
  postDocument,
  reverseDocument,
  type DeliveryNoteLine,
  type Document,
  type DocumentLine,
  type PostingResult,
} from "./document";
import { parseUnitCost, unitCostFromMillionths } from "./money";
import { stockOnHand, type Movement } from "./movement";

// Base units: grams for tomatoes, thousandths of an egg, millilitres of wine.
const conversions: readonly UnitConversion[] = [
  { productId: "tomatoes", unit: "g", factor: 1 },
  { productId: "tomatoes", unit: "kg", factor: 1000 },
  { productId: "tomatoes", unit: "box", factor: 6000 },
  { productId: "eggs", unit: "unit", factor: 1000 },
  { productId: "eggs", unit: "dozen", factor: 12_000 },
  { productId: "wine", unit: "bottle", factor: 750 },
];

/** A fresh ID source per test: id1, id2, … */
function counter(prefix = "id"): () => string {
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

function receipt(
  id: string,
  productId: string,
  storeroomId: string,
  quantity: number,
  cost: string,
): Movement {
  return {
    id,
    productId,
    storeroomId,
    quantity,
    unitCost: parseUnitCost(cost),
    documentLineId: `earlier/${id}`,
    kind: "receipt",
  };
}

// Before each example: 15 kg of tomatoes in the cold room at an average of €2.40/kg
// (10 kg at €2.00, then 5 kg at €3.20), and 30 eggs at €0.20 each.
const stock = deepFrozen([
  receipt("s1", "tomatoes", "cold-room", 10_000, "0.002"),
  receipt("s2", "tomatoes", "cold-room", 5000, "0.0032"),
  receipt("s3", "eggs", "cold-room", 30_000, "0.0002"),
]);

const header = {
  id: "d1",
  date: "2026-10-16",
  status: "review",
  storeroomId: "cold-room",
} as const;

function line(
  id: string,
  productId: string,
  quantity: string,
  unit: string,
  more: Partial<DocumentLine> = {},
): DocumentLine {
  return { id, productId, quantity, unit, ...more };
}

function pricedLine(
  id: string,
  productId: string,
  quantity: string,
  unit: string,
  price: string,
  more: Partial<DeliveryNoteLine> = {},
): DeliveryNoteLine {
  return {
    ...line(id, productId, quantity, unit),
    unitPrice: parseUnitCost(price),
    ...more,
  };
}

function post(document: Document, movements: readonly Movement[] = stock) {
  return postDocument(document, {
    movements,
    conversions,
    newId: counter("m"),
  });
}

/** The movements of a successful result; fails the test with its errors otherwise. */
function movementsOf(result: PostingResult): readonly Movement[] {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.movements;
}

function errorsOf(result: PostingResult) {
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("movements");
  return result.ok ? [] : result.errors;
}

describe("postDocument: a delivery note adds stock at its received unit cost", () => {
  it("1.5 boxes of tomatoes at €12.00 a box, 5% off: €17.10 for 9000 g, €0.001900/g; 2 dozen eggs at €2.40: €0.000200 per thousandth", () => {
    const note: Document = {
      ...header,
      type: "delivery-note",
      supplierId: "supplier-1",
      number: "A-123",
      lines: [
        pricedLine("l1", "tomatoes", "1.5", "box", "12.00", {
          discountPercent: "5",
          vatRate: "4",
        }),
        pricedLine("l2", "eggs", "2", "dozen", "2.40"),
      ],
    };
    const result = post(note);
    expect(result).toEqual({
      ok: true,
      document: { ...note, status: "posted" },
      movements: [
        {
          id: "m1",
          productId: "tomatoes",
          storeroomId: "cold-room",
          quantity: 9000,
          unitCost: parseUnitCost("0.0019"),
          documentLineId: "l1",
          kind: "receipt",
        },
        {
          id: "m2",
          productId: "eggs",
          storeroomId: "cold-room",
          quantity: 24_000,
          unitCost: parseUnitCost("0.0002"),
          documentLineId: "l2",
          kind: "receipt",
        },
      ],
    });
  });

  it("a return, −2 kg at €2.00/kg: −2000 g at €0.002000", () => {
    const note: Document = {
      ...header,
      type: "delivery-note",
      supplierId: "supplier-1",
      lines: [pricedLine("l1", "tomatoes", "-2", "kg", "2.00")],
    };
    expect(movementsOf(post(note))).toMatchObject([
      { quantity: -2000, unitCost: parseUnitCost("0.002"), kind: "receipt" },
    ]);
  });

  it("a line of 0 is rejected: it has no unit cost", () => {
    const note: Document = {
      ...header,
      type: "delivery-note",
      supplierId: "supplier-1",
      lines: [pricedLine("l1", "tomatoes", "0", "kg", "2.00")],
    };
    expect(errorsOf(post(note))).toEqual([
      { lineId: "l1", message: expect.stringContaining("non-zero") },
    ]);
  });
  it("a line with a storeroom of its own is received there: 2 dozen eggs into the dry store, the tomatoes into the note's cold room", () => {
    const note: Document = {
      ...header,
      type: "delivery-note",
      supplierId: "supplier-1",
      lines: [
        pricedLine("l1", "tomatoes", "1", "kg", "2.00"),
        pricedLine("l2", "eggs", "2", "dozen", "2.40", {
          storeroomId: "dry-store",
        }),
      ],
    };
    expect(movementsOf(post(note))).toMatchObject([
      { documentLineId: "l1", storeroomId: "cold-room", quantity: 1000 },
      { documentLineId: "l2", storeroomId: "dry-store", quantity: 24_000 },
    ]);
  });

  it("a return from a line's own storeroom is checked against that storeroom's stock: −1 kg of tomatoes from the dry store, which has none, is rejected (invariant 6)", () => {
    const note: Document = {
      ...header,
      type: "delivery-note",
      supplierId: "supplier-1",
      lines: [
        pricedLine("l1", "tomatoes", "-1", "kg", "2.00", {
          storeroomId: "dry-store",
        }),
      ],
    };
    expect(errorsOf(post(note))).toEqual([
      { lineId: "l1", message: expect.stringContaining("dry-store") },
    ]);
  });
});

describe("postDocument: waste removes stock at the average cost", () => {
  it("250 g of tomatoes from the cold room: −250 g at the €0.0024/g average", () => {
    const waste: Document = {
      ...header,
      type: "waste",
      lines: [line("l1", "tomatoes", "250", "g")],
    };
    expect(movementsOf(post(waste))).toEqual([
      {
        id: "m1",
        productId: "tomatoes",
        storeroomId: "cold-room",
        quantity: -250,
        unitCost: parseUnitCost("0.0024"),
        documentLineId: "l1",
        kind: "waste",
      },
    ]);
  });

  it("wasting 15 001 g with 15 000 g on hand is rejected (invariant 6), naming the line", () => {
    const waste: Document = {
      ...header,
      type: "waste",
      lines: [line("l1", "tomatoes", "15001", "g")],
    };
    expect(errorsOf(post(waste))).toEqual([
      { lineId: "l1", message: expect.stringContaining("to -1") },
    ]);
  });

  it("the same line flagged as an adjustment is accepted, and its movement is flagged", () => {
    const waste: Document = {
      ...header,
      type: "waste",
      lines: [line("l1", "tomatoes", "15001", "g", { adjustment: true })],
    };
    expect(movementsOf(post(waste))).toMatchObject([
      { quantity: -15_001, adjustment: true },
    ]);
  });

  it("lines are checked against the stock left by the lines before them: 10 kg, then 6 kg more, fails on the second", () => {
    const waste: Document = {
      ...header,
      type: "waste",
      lines: [
        line("l1", "tomatoes", "10", "kg"),
        line("l2", "tomatoes", "6", "kg"),
      ],
    };
    expect(errorsOf(post(waste))).toEqual([
      { lineId: "l2", message: expect.stringContaining("to -1000") },
    ]);
  });
});

describe("postDocument: a count posts the difference between counted and on-hand stock", () => {
  it("tomatoes counted at 14.75 kg with 15 kg on hand: −250 g; 32 eggs with 30 on hand: +2 eggs; 0 wine with none on hand: a movement of 0", () => {
    const count: Document = {
      ...header,
      type: "count",
      lines: [
        line("l1", "tomatoes", "14.75", "kg"),
        line("l2", "eggs", "32", "unit"),
        line("l3", "wine", "0", "bottle"),
      ],
    };
    const movements = movementsOf(post(count));
    expect(movements).toMatchObject([
      {
        documentLineId: "l1",
        quantity: -250,
        unitCost: parseUnitCost("0.0024"),
        kind: "count",
      },
      {
        documentLineId: "l2",
        quantity: 2000,
        unitCost: parseUnitCost("0.0002"),
        kind: "count",
      },
      {
        documentLineId: "l3",
        quantity: 0,
        unitCost: parseUnitCost("0"),
        kind: "count",
      },
    ]);
    const after = [...stock, ...movements];
    expect(stockOnHand(after, "tomatoes", "cold-room")).toBe(14_750);
    expect(stockOnHand(after, "eggs", "cold-room")).toBe(32_000);
  });

  it("rejects the same product counted twice, on the second line", () => {
    const count: Document = {
      ...header,
      type: "count",
      lines: [
        line("l1", "tomatoes", "14", "kg"),
        line("l2", "tomatoes", "500", "g"),
      ],
    };
    expect(errorsOf(post(count))).toEqual([
      {
        lineId: "l2",
        message: "product tomatoes is counted twice in this count",
      },
    ]);
  });

  // A count made offline at 10:00 and synced at 14:00 (#148, decision 0043): `stock` is what was
  // posted before 10:00, and whatever comes after it was posted in between.
  const deliveredAtNoon = receipt("n1", "tomatoes", "cold-room", 5000, "0.003");

  it("counted at 10:00, synced at 14:00 after a 12:00 delivery of 5 kg: 14.75 kg against the 15 kg on hand then, −250 g at that time's €0.0024/g; stock is 14.75 + 5 = 19.75 kg", () => {
    const count: Document = {
      ...header,
      type: "count",
      movementsBeforeCount: stock.length,
      lines: [line("l1", "tomatoes", "14.75", "kg")],
    };
    const movements = movementsOf(post(count, [...stock, deliveredAtNoon]));
    expect(movements).toEqual([
      expect.objectContaining({
        quantity: -250,
        unitCost: parseUnitCost("0.0024"),
        kind: "count",
      }),
    ]);
    expect(movements[0]).not.toHaveProperty("adjustment");
    const after = [...stock, deliveredAtNoon, ...movements];
    expect(stockOnHand(after, "tomatoes", "cold-room")).toBe(19_750);
  });

  it("counted at 0 at 10:00, after 2 kg of waste posted at 11:00: −15 kg would leave −2 kg, so it's a flagged adjustment", () => {
    const wasted: Movement = {
      ...receipt("w1", "tomatoes", "cold-room", -2000, "0.0024"),
      kind: "waste",
    };
    const count: Document = {
      ...header,
      type: "count",
      movementsBeforeCount: stock.length,
      lines: [line("l1", "tomatoes", "0", "kg")],
    };
    const movements = movementsOf(post(count, [...stock, wasted]));
    expect(movements).toEqual([
      expect.objectContaining({
        quantity: -15_000,
        kind: "count",
        adjustment: true,
      }),
    ]);
    const after = [...stock, wasted, ...movements];
    expect(stockOnHand(after, "tomatoes", "cold-room")).toBe(-2000);
  });

  it("counted with every movement before it: the same movements as a count that doesn't say", () => {
    const lines = [
      line("l1", "tomatoes", "14.75", "kg"),
      line("l2", "eggs", "32", "unit"),
    ];
    const now = movementsOf(post({ ...header, type: "count", lines }));
    const said = movementsOf(
      post({
        ...header,
        type: "count",
        movementsBeforeCount: stock.length,
        lines,
      }),
    );
    expect(said).toEqual(now);
  });

  it("rejects a count said to be made before the first movement, after the last, or between two", () => {
    for (const movementsBeforeCount of [-1, stock.length + 1, 1.5]) {
      const count: Document = {
        ...header,
        type: "count",
        movementsBeforeCount,
        lines: [line("l1", "tomatoes", "14", "kg")],
      };
      expect(errorsOf(post(count))).toEqual([
        {
          message: `count d1 says it was made after ${movementsBeforeCount} movements, but there are ${stock.length}`,
        },
      ]);
    }
  });

  it("rejects a negative count", () => {
    const count: Document = {
      ...header,
      type: "count",
      lines: [line("l1", "tomatoes", "-1", "kg")],
    };
    expect(errorsOf(post(count))).toEqual([
      {
        lineId: "l1",
        message: "a counted quantity can't be negative, got -1 kg",
      },
    ]);
  });
});

describe("postDocument: a transfer posts a matching pair", () => {
  it("5 kg of tomatoes from the cold room to the dry store: −5000 g out and +5000 g in, both at the cold room's €0.0024/g", () => {
    const transfer: Document = {
      ...header,
      type: "transfer",
      toStoreroomId: "dry-store",
      lines: [line("l1", "tomatoes", "5", "kg")],
    };
    expect(movementsOf(post(transfer))).toEqual([
      {
        id: "m1",
        productId: "tomatoes",
        storeroomId: "cold-room",
        quantity: -5000,
        unitCost: parseUnitCost("0.0024"),
        documentLineId: "l1",
        kind: "transfer-out",
      },
      {
        id: "m2",
        productId: "tomatoes",
        storeroomId: "dry-store",
        quantity: 5000,
        unitCost: parseUnitCost("0.0024"),
        documentLineId: "l1",
        kind: "transfer-in",
      },
    ]);
  });

  it("rejects a transfer into the storeroom it comes from", () => {
    const transfer: Document = {
      ...header,
      type: "transfer",
      toStoreroomId: "cold-room",
      lines: [line("l1", "tomatoes", "5", "kg")],
    };
    expect(errorsOf(post(transfer))).toEqual([
      {
        message:
          "document d1 transfers from cold-room to cold-room; a transfer must go to another storeroom",
      },
    ]);
  });

  it("moving more than is on hand is rejected; flagged, only the movement out is flagged", () => {
    const transfer = (more: Partial<DocumentLine> = {}): Document => ({
      ...header,
      type: "transfer",
      toStoreroomId: "dry-store",
      lines: [line("l1", "tomatoes", "16", "kg", more)],
    });
    expect(errorsOf(post(transfer()))).toEqual([
      { lineId: "l1", message: expect.stringContaining("to -1000") },
    ]);
    const [out, into] = movementsOf(post(transfer({ adjustment: true })));
    expect(out).toMatchObject({ kind: "transfer-out", adjustment: true });
    expect(into).not.toHaveProperty("adjustment");
  });
});

describe("postDocument: all or nothing", () => {
  it("reports every failing line, and no movements: an unknown unit, a fraction of a gram, a negative waste", () => {
    const waste: Document = {
      ...header,
      type: "waste",
      lines: [
        line("l1", "tomatoes", "1", "crate"),
        line("l2", "tomatoes", "0.0001", "kg"),
        line("l3", "tomatoes", "-1", "kg"),
        line("l4", "tomatoes", "1", "kg"),
      ],
    };
    expect(errorsOf(post(waste))).toEqual([
      {
        lineId: "l1",
        message: '"crate" has no conversion for product tomatoes',
      },
      {
        lineId: "l2",
        message:
          "0.0001 kg of product tomatoes is 0.1 base units, not a whole number",
      },
      {
        lineId: "l3",
        message: "a waste quantity must be positive, got -1 kg",
      },
    ]);
  });

  it("rejects a document that is already posted", () => {
    const waste: Document = {
      ...header,
      status: "posted",
      type: "waste",
      lines: [line("l1", "tomatoes", "1", "kg")],
    };
    expect(errorsOf(post(waste))).toEqual([
      { message: "document d1 is already posted" },
    ]);
  });

  it("rejects a document with no lines", () => {
    const waste: Document = { ...header, type: "waste", lines: [] };
    expect(errorsOf(post(waste))).toEqual([
      { message: "document d1 has no lines" },
    ]);
  });
});

describe("reverseDocument: a posted document's reversal, and corrections", () => {
  const note: Document = deepFrozen({
    ...header,
    type: "delivery-note",
    supplierId: "supplier-1",
    lines: [
      pricedLine("l1", "tomatoes", "1.5", "box", "12.00"),
      pricedLine("l2", "eggs", "2", "dozen", "2.40"),
    ],
  });

  function posted(document: Document = note) {
    const result = postDocument(document, {
      movements: stock,
      conversions,
      newId: counter("m"),
    });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return { document: result.document, all: [...stock, ...result.movements] };
  }

  it("a posted delivery note: a posted document reversing it, with new lines, and a reversing movement for each movement, last first", () => {
    const { document, all } = posted();
    const result = reverseDocument(document, all, {
      id: "d2",
      date: "2026-10-17",
      newId: counter("r"),
    });
    expect(result).toEqual({
      ok: true,
      document: {
        ...document,
        id: "d2",
        date: "2026-10-17",
        reverses: "d1",
        lines: [
          { ...note.lines[0], id: "r1" },
          { ...note.lines[1], id: "r2" },
        ],
      },
      movements: [
        {
          id: "r3",
          productId: "eggs",
          storeroomId: "cold-room",
          quantity: -24_000,
          unitCost: parseUnitCost("0.0002"),
          documentLineId: "r2",
          kind: "receipt",
          reverses: "m2",
        },
        {
          id: "r4",
          productId: "tomatoes",
          storeroomId: "cold-room",
          quantity: -9000,
          unitCost: parseUnitCost("0.002"),
          documentLineId: "r1",
          kind: "receipt",
          reverses: "m1",
        },
      ],
    });
    const after = [...all, ...movementsOf(result)];
    expect(stockOnHand(after, "tomatoes", "cold-room")).toBe(15_000);
    expect(stockOnHand(after, "eggs", "cold-room")).toBe(30_000);
  });

  it("a transfer: both movements of its line reversed, on the one reversing line", () => {
    const { document, all } = posted({
      ...header,
      type: "transfer",
      toStoreroomId: "dry-store",
      lines: [line("l1", "tomatoes", "5", "kg")],
    });
    const result = reverseDocument(document, all, {
      id: "d2",
      date: "2026-10-17",
      newId: counter("r"),
    });
    expect(movementsOf(result)).toMatchObject([
      {
        storeroomId: "dry-store",
        quantity: -5000,
        documentLineId: "r1",
        reverses: "m2",
      },
      {
        storeroomId: "cold-room",
        quantity: 5000,
        documentLineId: "r1",
        reverses: "m1",
      },
    ]);
  });

  it("rejects a document that isn't posted", () => {
    expect(
      errorsOf(
        reverseDocument(note, stock, {
          id: "d2",
          date: "2026-10-17",
          newId: counter("r"),
        }),
      ),
    ).toEqual([{ message: "document d1 is not posted (status review)" }]);
  });

  it("rejects reversing a reversal: post a new document instead", () => {
    const { document, all } = posted();
    const reversal = reverseDocument(document, all, {
      id: "d2",
      date: "2026-10-17",
      newId: counter("r"),
    });
    if (!reversal.ok) throw new Error("the first reversal should succeed");
    expect(
      errorsOf(
        reverseDocument(reversal.document, [...all, ...reversal.movements], {
          id: "d3",
          date: "2026-10-18",
          newId: counter("x"),
        }),
      ),
    ).toEqual([
      {
        message:
          "document d2 is itself a reversal (of d1); post a new document instead",
      },
    ]);
  });

  it("rejects reversing a document twice, naming its lines", () => {
    const { document, all } = posted();
    const first = reverseDocument(document, all, {
      id: "d2",
      date: "2026-10-17",
      newId: counter("r"),
    });
    expect(
      errorsOf(
        reverseDocument(document, [...all, ...movementsOf(first)], {
          id: "d3",
          date: "2026-10-18",
          newId: counter("x"),
        }),
      ),
    ).toEqual([
      { lineId: "l2", message: "movement m2 is already reversed by r3" },
      { lineId: "l1", message: "movement m1 is already reversed by r4" },
    ]);
  });

  it("rejects a document whose movements aren't in the movements given", () => {
    const { document } = posted();
    expect(
      errorsOf(
        reverseDocument(document, stock, {
          id: "d2",
          date: "2026-10-17",
          newId: counter("r"),
        }),
      ),
    ).toEqual([
      { message: "document d1 has no movements in the movements given" },
    ]);
  });

  it("a correction: 10 kg received but 12 kg on the corrected note, 9 kg already used. Reversing first is rejected; posting the correction first, then reversing, leaves 3 kg", () => {
    const empty: readonly Movement[] = [];
    const wrong = postDocument(
      {
        ...header,
        type: "delivery-note",
        supplierId: "supplier-1",
        lines: [pricedLine("l1", "tomatoes", "10", "kg", "2.00")],
      },
      { movements: empty, conversions, newId: counter("a") },
    );
    if (!wrong.ok) throw new Error("the wrong note should post");
    const used = postDocument(
      {
        ...header,
        id: "d2",
        type: "waste",
        lines: [line("w1", "tomatoes", "9", "kg")],
      },
      { movements: wrong.movements, conversions, newId: counter("b") },
    );
    const afterUse = [...wrong.movements, ...movementsOf(used)];

    const reverseFirst = reverseDocument(wrong.document, afterUse, {
      id: "d3",
      date: "2026-10-17",
      newId: counter("c"),
    });
    expect(errorsOf(reverseFirst)).toEqual([
      { lineId: "l1", message: expect.stringContaining("to -9000") },
    ]);

    const corrected = postDocument(
      {
        ...header,
        id: "d4",
        type: "delivery-note",
        supplierId: "supplier-1",
        lines: [pricedLine("c1", "tomatoes", "12", "kg", "2.00")],
      },
      { movements: afterUse, conversions, newId: counter("d") },
    );
    const withCorrection = [...afterUse, ...movementsOf(corrected)];
    const reversal = reverseDocument(wrong.document, withCorrection, {
      id: "d5",
      date: "2026-10-17",
      newId: counter("e"),
    });
    const final = [...withCorrection, ...movementsOf(reversal)];
    expect(stockOnHand(final, "tomatoes", "cold-room")).toBe(3000);
  });
});

// Generators. Mostly valid lines, so that many documents post, plus some that fail: units the
// product doesn't have, fractions of a base unit, zero and negative quantities.
const PRODUCTS = ["tomatoes", "eggs", "wine"];
const STOREROOMS = ["cold-room", "dry-store"];
const unitsOf = (productId: string) =>
  conversions.filter((c) => c.productId === productId).map((c) => c.unit);

const lineFields = fc.constantFrom(...PRODUCTS).chain((productId) =>
  fc.record({
    productId: fc.constant(productId),
    unit: fc.oneof(
      { weight: 19, arbitrary: fc.constantFrom(...unitsOf(productId)) },
      { weight: 1, arbitrary: fc.constant("crate") },
    ),
    quantity: fc.oneof(
      { weight: 16, arbitrary: fc.integer({ min: 1, max: 20 }).map(String) },
      { weight: 3, arbitrary: fc.constantFrom("0.5", "1.5", "2.25") },
      { weight: 1, arbitrary: fc.constantFrom("0", "-1", "0.0001") },
    ),
    unitPrice: fc
      .bigInt({ min: 0n, max: 10n ** 8n })
      .map(unitCostFromMillionths),
    discountPercent: fc.constantFrom("0", "5", "12.5"),
    adjustment: fc.oneof(
      { weight: 9, arbitrary: fc.constant(false) },
      { weight: 1, arbitrary: fc.constant(true) },
    ),
  }),
);

function linesFrom(
  fields: { adjustment: boolean; [key: string]: unknown }[],
): DeliveryNoteLine[] {
  return fields.map(({ adjustment, ...f }, i) => ({
    ...(f as Omit<DeliveryNoteLine, "id" | "adjustment">),
    id: `l${i}`,
    ...(adjustment ? { adjustment: true as const } : {}),
  }));
}

const documentArb = fc
  .record({
    type: fc.constantFrom(
      "delivery-note" as const,
      "waste" as const,
      "count" as const,
      "transfer" as const,
    ),
    storeroomId: fc.constantFrom(...STOREROOMS),
    otherStoreroom: fc.oneof(
      { weight: 9, arbitrary: fc.constant(true) },
      { weight: 1, arbitrary: fc.constant(false) },
    ),
    status: fc.constantFrom("draft" as const, "review" as const),
    lines: fc.array(lineFields, { minLength: 1, maxLength: 5 }),
  })
  .map(({ type, storeroomId, otherStoreroom, status, lines }): Document => {
    const base = { id: "d1", date: "2026-10-16", status, storeroomId };
    const documentLines = linesFrom(lines);
    switch (type) {
      case "delivery-note":
        return {
          ...base,
          type,
          supplierId: "supplier-1",
          lines: documentLines,
        };
      case "transfer": {
        const other = STOREROOMS.find((s) => s !== storeroomId) ?? storeroomId;
        return {
          ...base,
          type,
          toStoreroomId: otherStoreroom ? other : storeroomId,
          lines: documentLines,
        };
      }
      default:
        return { ...base, type, lines: documentLines };
    }
  });

const everyLocation = PRODUCTS.flatMap((p) =>
  STOREROOMS.map((s) => [p, s] as const),
);

/**
 * Stock already posted: one receipt of each product in each storeroom, 0 to 300 kg (or litres,
 * or eggs), at any cost. Most generated waste and transfers fit; some don't.
 */
const stockArb = fc
  .array(
    fc.record({
      quantity: fc.integer({ min: 0, max: 300_000 }),
      cost: fc.bigInt({ min: 0n, max: 10n ** 7n }),
    }),
    { minLength: everyLocation.length, maxLength: everyLocation.length },
  )
  .map((rs) =>
    deepFrozen(
      everyLocation.map(([productId, storeroomId], i): Movement => ({
        id: `s${i}`,
        productId,
        storeroomId,
        quantity: rs[i]?.quantity ?? 0,
        unitCost: unitCostFromMillionths(rs[i]?.cost ?? 0n),
        documentLineId: `earlier/s${i}`,
        kind: "receipt",
      })),
    ),
  );

function context(movements: readonly Movement[]) {
  return { movements, conversions, newId: counter("m") };
}

describe("posting properties", () => {
  it("invariant 2: every movement from posting or reversing points to a line of the posted document returned with it", () => {
    fc.assert(
      fc.property(documentArb, stockArb, (document, existing) => {
        const result = postDocument(document, context(existing));
        if (!result.ok) return;
        const check = ({ document: posted, movements }: typeof result) => {
          expect(posted.status).toBe("posted");
          const lineIds = new Set(posted.lines.map((l) => l.id));
          for (const m of movements) {
            expect(lineIds.has(m.documentLineId)).toBe(true);
          }
        };
        check(result);
        const reversal = reverseDocument(
          result.document,
          [...existing, ...result.movements],
          { id: "d2", date: "2026-10-17", newId: counter("r") },
        );
        if (reversal.ok) check(reversal);
      }),
    );
  });

  it("invariant 4: if any line fails, posting returns an error naming every failing line and no movements; one broken line anywhere in a document is enough", () => {
    fc.assert(
      fc.property(documentArb, stockArb, fc.nat(), (document, existing, at) => {
        const broken = linesFrom([
          {
            productId: "tomatoes",
            unit: "crate",
            quantity: "1",
            unitPrice: parseUnitCost("1"),
            adjustment: false,
          },
        ])[0]!;
        const lines = [...document.lines];
        lines.splice(at % (lines.length + 1), 0, { ...broken, id: "broken" });
        const withBroken = { ...document, lines } as Document;

        const errors = errorsOf(postDocument(withBroken, context(existing)));
        // Usually for its unit; in a count that already has tomatoes, for counting them twice.
        expect(errors).toContainEqual({
          lineId: "broken",
          message: expect.any(String),
        });
        const lineIds = new Set(lines.map((l) => l.id));
        for (const error of errors) {
          if (error.lineId !== undefined) {
            expect(lineIds.has(error.lineId)).toBe(true);
          }
        }
      }),
    );
  });

  it("invariant 4: if posting succeeds, every line produced its movements: one per line, two per transfer line, matching the line's quantity", () => {
    fc.assert(
      fc.property(documentArb, stockArb, (document, existing) => {
        const result = postDocument(document, context(existing));
        if (!result.ok) return;
        let expected = 0;
        for (const l of document.lines) {
          const q = toBaseUnits(l, conversions);
          const ms = result.movements.filter((m) => m.documentLineId === l.id);
          const s = document.storeroomId;
          switch (document.type) {
            case "delivery-note":
              expect(ms).toMatchObject([
                { kind: "receipt", storeroomId: s, quantity: q },
              ]);
              break;
            case "waste":
              expect(ms).toMatchObject([
                { kind: "waste", storeroomId: s, quantity: -q },
              ]);
              break;
            case "count":
              expect(ms).toHaveLength(1);
              expect(ms[0]).toMatchObject({ kind: "count", storeroomId: s });
              expect(
                stockOnHand(existing, l.productId, s) + ms[0]!.quantity,
              ).toBe(q);
              break;
            case "transfer":
              expect(ms).toMatchObject([
                { kind: "transfer-out", storeroomId: s, quantity: -q },
                {
                  kind: "transfer-in",
                  storeroomId: document.toStoreroomId,
                  quantity: q,
                },
              ]);
              break;
          }
          for (const m of ms) expect(m.productId).toBe(l.productId);
          expected += ms.length;
        }
        expect(result.movements).toHaveLength(expected);
      }),
    );
  });

  it("invariant 7: posting never changes the document it was given, and a posted document can't be posted again", () => {
    fc.assert(
      fc.property(documentArb, stockArb, (document, existing) => {
        const frozen = deepFrozen(document);
        const before = structuredClone(frozen);
        const result = postDocument(frozen, context(existing));
        expect(frozen).toEqual(before);
        if (!result.ok) return;
        const again = postDocument(result.document, context(existing));
        expect(errorsOf(again)).toEqual([
          { message: "document d1 is already posted" },
        ]);
      }),
    );
  });

  it("invariant 7: reversing never changes the posted document or the existing movements", () => {
    fc.assert(
      fc.property(documentArb, stockArb, (document, existing) => {
        const result = postDocument(document, context(existing));
        if (!result.ok) return;
        const posted = deepFrozen(result.document);
        const all = deepFrozen([...existing, ...result.movements]);
        const before = structuredClone({ posted, all });
        reverseDocument(posted, all, {
          id: "d2",
          date: "2026-10-17",
          newId: counter("r"),
        });
        expect({ posted, all }).toEqual(before);
      }),
    );
  });

  it("after a count, each counted product's stock in that storeroom equals the counted quantity", () => {
    fc.assert(
      fc.property(documentArb, stockArb, (document, existing) => {
        if (document.type !== "count") return;
        const result = postDocument(document, context(existing));
        if (!result.ok) return;
        const after = [...existing, ...result.movements];
        for (const l of document.lines) {
          expect(stockOnHand(after, l.productId, document.storeroomId)).toBe(
            toBaseUnits(l, conversions),
          );
        }
      }),
    );
  });

  it("every receipt of a delivery note goes to its line's storeroom, or to the note's if the line names none", () => {
    fc.assert(
      fc.property(
        documentArb,
        stockArb,
        fc.array(fc.option(fc.constantFrom(...STOREROOMS)), {
          minLength: 5,
          maxLength: 5,
        }),
        (document, existing, choices) => {
          if (document.type !== "delivery-note") return;
          const lines = document.lines.map((l, i) => {
            const storeroomId = choices[i];
            return storeroomId === null || storeroomId === undefined
              ? l
              : { ...l, storeroomId };
          });
          const result = postDocument(
            { ...document, lines },
            context(existing),
          );
          if (!result.ok) return;
          for (const l of lines) {
            const [receipt] = result.movements.filter(
              (m) => m.documentLineId === l.id,
            );
            expect(receipt?.storeroomId).toBe(
              l.storeroomId ?? document.storeroomId,
            );
          }
        },
      ),
    );
  });

  it("naming the note's own storeroom on every line posts exactly the same movements", () => {
    fc.assert(
      fc.property(documentArb, stockArb, (document, existing) => {
        if (document.type !== "delivery-note") return;
        const named = {
          ...document,
          lines: document.lines.map((l) => ({
            ...l,
            storeroomId: document.storeroomId,
          })),
        };
        const plain = postDocument(document, context(existing));
        const withStorerooms = postDocument(named, context(existing));
        expect(withStorerooms.ok).toBe(plain.ok);
        if (plain.ok && withStorerooms.ok) {
          expect(withStorerooms.movements).toEqual(plain.movements);
        } else if (!plain.ok && !withStorerooms.ok) {
          expect(withStorerooms.errors).toEqual(plain.errors);
        }
      }),
    );
  });

  it("a document without flagged lines, reversed right after posting, leaves stock as if neither had been posted", () => {
    fc.assert(
      fc.property(documentArb, stockArb, (document, existing) => {
        if (document.lines.some((l) => l.adjustment === true)) return;
        const result = postDocument(document, context(existing));
        if (!result.ok) return;
        const all = [...existing, ...result.movements];
        const reversal = reverseDocument(result.document, all, {
          id: "d2",
          date: "2026-10-17",
          newId: counter("r"),
        });
        const after = [...all, ...movementsOf(reversal)];
        for (const [p, s] of everyLocation) {
          expect(stockOnHand(after, p, s)).toBe(stockOnHand(existing, p, s));
        }
      }),
    );
  });
});

// Late counts (#148, decision 0043): made after some of the movements, posted after all of them.
// Counted products are distinct and counted in their own units, so every count posts.
const lateCountArb = fc
  .record({
    storeroomId: fc.constantFrom(...STOREROOMS),
    counted: fc.uniqueArray(
      fc.record({
        productId: fc.constantFrom(...PRODUCTS),
        quantity: fc.integer({ min: 0, max: 400 }),
      }),
      {
        minLength: 1,
        maxLength: PRODUCTS.length,
        selector: (c) => c.productId,
      },
    ),
    // Posted since the count: in and out, in any place.
    since: fc.array(
      fc.record({
        productId: fc.constantFrom(...PRODUCTS),
        storeroomId: fc.constantFrom(...STOREROOMS),
        quantity: fc.integer({ min: -300_000, max: 300_000 }),
        cost: fc.bigInt({ min: 0n, max: 10n ** 7n }),
      }),
      { maxLength: 8 },
    ),
  })
  .map(({ storeroomId, counted, since }) => ({
    count: {
      id: "c1",
      date: "2026-10-16",
      status: "review",
      storeroomId,
      type: "count",
      lines: counted.map((c, i) => ({
        id: `l${i}`,
        productId: c.productId,
        quantity: String(c.quantity),
        unit: unitsOf(c.productId)[0]!,
      })),
    } satisfies Document,
    since: since.map((f, i): Movement => ({
      id: `n${i}`,
      productId: f.productId,
      storeroomId: f.storeroomId,
      quantity: f.quantity,
      unitCost: unitCostFromMillionths(f.cost),
      documentLineId: `since/n${i}`,
      kind: f.quantity >= 0 ? "receipt" : "waste",
    })),
  }));

describe("late count properties", () => {
  it("after a late count, each counted product's stock is what was counted plus what was posted since", () => {
    fc.assert(
      fc.property(lateCountArb, stockArb, ({ count, since }, before) => {
        const movements = [...before, ...since];
        const late = { ...count, movementsBeforeCount: before.length };
        const result = postDocument(late, context(movements));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        const after = [...movements, ...result.movements];
        for (const l of count.lines) {
          const sinceHere = stockOnHand(since, l.productId, count.storeroomId);
          expect(stockOnHand(after, l.productId, count.storeroomId)).toBe(
            toBaseUnits(l, conversions) + sinceHere,
          );
        }
      }),
    );
  });

  it("invariant 6: a late count takes stock below zero only as a flagged adjustment, and is flagged only when it does", () => {
    fc.assert(
      fc.property(lateCountArb, stockArb, ({ count, since }, before) => {
        const movements = [...before, ...since];
        const late = { ...count, movementsBeforeCount: before.length };
        const result = postDocument(late, context(movements));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        for (const m of result.movements) {
          const left =
            stockOnHand(movements, m.productId, m.storeroomId) + m.quantity;
          expect(m.adjustment === true).toBe(m.quantity < 0 && left < 0);
        }
      }),
    );
  });

  it("a late count moves only the products it counts, only in its storeroom, one movement each", () => {
    fc.assert(
      fc.property(lateCountArb, stockArb, ({ count, since }, before) => {
        const movements = [...before, ...since];
        const late = { ...count, movementsBeforeCount: before.length };
        const result = postDocument(late, context(movements));
        if (!result.ok) throw new Error(JSON.stringify(result.errors));
        const counted = new Set(count.lines.map((l) => l.productId));
        for (const m of result.movements) {
          expect(m.storeroomId).toBe(count.storeroomId);
          expect(counted.has(m.productId)).toBe(true);
        }
        expect(result.movements).toHaveLength(count.lines.length);
      }),
    );
  });

  it("invariant 5: posting the same late count against the same movements gives the same movements, stock and costs, also from a fresh copy", () => {
    fc.assert(
      fc.property(lateCountArb, stockArb, ({ count, since }, before) => {
        const movements = [...before, ...since];
        const late = { ...count, movementsBeforeCount: before.length };
        const first = postDocument(late, context(movements));
        const again = postDocument(late, context(movements));
        const fresh = postDocument(
          structuredClone(late),
          context(structuredClone(movements)),
        );
        expect(again).toEqual(first);
        expect(fresh).toEqual(first);
      }),
    );
  });
});
