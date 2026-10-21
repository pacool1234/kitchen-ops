import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { averageCost } from "./cost";
import {
  formatMoney,
  parseUnitCost,
  sumMoney,
  unitCostFromMillionths,
} from "./money";
import { stockOnHand, type Movement, type MovementKind } from "./movement";
import { stockValue, valuation } from "./valuation";

// What stock is worth (#148, decision 0043): on hand × average cost, rounded to cents at each
// product and storeroom, and totals that are sums of those, so the figures on screen add up.

/** Freezes a list and every movement in it, so any attempt to change them throws. */
function frozen(movements: Movement[]): readonly Movement[] {
  return Object.freeze(movements.map((m) => Object.freeze({ ...m })));
}

const value = (onHand: number, cost: string) =>
  formatMoney(stockValue(onHand, parseUnitCost(cost)));

describe("stockValue: on hand × average cost, rounded to cents, half away from zero", () => {
  it("2350 g of solomillo at €0.033400/g: €78.49 exactly", () => {
    expect(value(2350, "0.033400")).toBe("78.49");
  });

  it("1080 g of panceta at €0.010898/g: €11.76984, rounded up to €11.77", () => {
    expect(value(1080, "0.010898")).toBe("11.77");
  });

  it("3 g at €0.001666/g: €0.004998, rounded down to €0.00", () => {
    expect(value(3, "0.001666")).toBe("0.00");
  });

  it("5000 g at €0.000001/g: exactly half a cent, rounded away from zero to €0.01; −5000 g, to −€0.01", () => {
    expect(value(5000, "0.000001")).toBe("0.01");
    expect(value(-5000, "0.000001")).toBe("-0.01");
  });

  it("nothing on hand: €0.00, whatever its cost", () => {
    expect(value(0, "12.345678")).toBe("0.00");
  });
});

/** A movement of `productId` in `storeroomId`; a receipt unless said otherwise. */
function moved(
  id: string,
  productId: string,
  storeroomId: string,
  quantity: number,
  cost: string,
  kind: MovementKind = "receipt",
): Movement {
  return {
    id,
    productId,
    storeroomId,
    quantity,
    unitCost: parseUnitCost(cost),
    documentLineId: `line-${id}`,
    kind,
  };
}

describe("valuation: every product's stock, average cost and value in each storeroom, and the totals", () => {
  it("15 kg of tomatoes at €2.40/kg in the cold room (€36.00), 5 kg at €2.00/kg in the dry store (€10.00), 30 eggs at €0.20 (€6.00): €42.00 and €10.00, €52.00 in all", () => {
    const result = valuation(
      frozen([
        moved("m1", "tomatoes", "cold-room", 10_000, "0.002"),
        moved("m2", "tomatoes", "cold-room", 5000, "0.0032"),
        moved("m3", "tomatoes", "dry-store", 5000, "0.002"),
        moved("m4", "eggs", "cold-room", 30_000, "0.0002"),
      ]),
    );
    expect(
      result.places.map((p) => ({
        ...p,
        averageCost: p.averageCost.toString(),
        value: formatMoney(p.value),
      })),
    ).toEqual([
      {
        productId: "tomatoes",
        storeroomId: "cold-room",
        onHand: 15_000,
        averageCost: "2400",
        value: "36.00",
      },
      {
        productId: "tomatoes",
        storeroomId: "dry-store",
        onHand: 5000,
        averageCost: "2000",
        value: "10.00",
      },
      {
        productId: "eggs",
        storeroomId: "cold-room",
        onHand: 30_000,
        averageCost: "200",
        value: "6.00",
      },
    ]);
    expect(
      [...result.storerooms].map(([id, v]) => [id, formatMoney(v)]),
    ).toEqual([
      ["cold-room", "42.00"],
      ["dry-store", "10.00"],
    ]);
    expect(formatMoney(result.total)).toBe("52.00");
  });

  it("three products worth €0.004 each are €0.00 each, so €0.00 in all, not €0.01: totals add up what's shown", () => {
    const result = valuation(
      frozen([
        moved("m1", "salt", "dry-store", 1, "0.004"),
        moved("m2", "pepper", "dry-store", 1, "0.004"),
        moved("m3", "saffron", "dry-store", 1, "0.004"),
      ]),
    );
    expect(result.places.map((p) => formatMoney(p.value))).toEqual([
      "0.00",
      "0.00",
      "0.00",
    ]);
    expect(formatMoney(result.storerooms.get("dry-store")!)).toBe("0.00");
    expect(formatMoney(result.total)).toBe("0.00");
  });

  it("a place whose stock is all gone is still listed, at €0.00", () => {
    const result = valuation(
      frozen([
        moved("m1", "tomatoes", "cold-room", 2000, "0.002"),
        moved("m2", "tomatoes", "cold-room", -2000, "0.002", "waste"),
      ]),
    );
    expect(result.places).toMatchObject([{ onHand: 0 }]);
    expect(formatMoney(result.places[0]!.value)).toBe("0.00");
  });

  it("no movements: no places, no storerooms, €0.00", () => {
    const result = valuation([]);
    expect(result.places).toEqual([]);
    expect(result.storerooms.size).toBe(0);
    expect(formatMoney(result.total)).toBe("0.00");
  });
});

const PRODUCTS = ["tomatoes", "eggs", "wine"];
const STOREROOMS = ["cold-room", "dry-store", "bar"];
const KINDS: readonly MovementKind[] = [
  "receipt",
  "waste",
  "count",
  "transfer-out",
  "transfer-in",
];
const unitCost = fc
  .bigInt({ min: 0n, max: 10n ** 8n })
  .map(unitCostFromMillionths);

// Any movements in a few places, in and out, with unique IDs; some reversed.
const movementList = fc
  .array(
    fc.record({
      productId: fc.constantFrom(...PRODUCTS),
      storeroomId: fc.constantFrom(...STOREROOMS),
      quantity: fc.integer({ min: -1_000_000, max: 1_000_000 }),
      unitCost,
      kind: fc.constantFrom(...KINDS),
      reversedLater: fc.boolean(),
    }),
    { maxLength: 40 },
  )
  .map((fields) => {
    const ms: Movement[] = fields.map((f, i) => ({
      id: `m${i}`,
      productId: f.productId,
      storeroomId: f.storeroomId,
      quantity: f.quantity,
      unitCost: f.unitCost,
      documentLineId: `line${i}`,
      kind: f.kind,
    }));
    const reversals = fields.flatMap((f, i): Movement[] =>
      f.reversedLater
        ? [
            {
              ...ms[i]!,
              id: `r${i}`,
              quantity: -ms[i]!.quantity,
              reverses: ms[i]!.id,
              documentLineId: `reversal-line${i}`,
            },
          ]
        : [],
    );
    return frozen([...ms, ...reversals]);
  });

describe("valuation properties", () => {
  it("nothing on hand is worth €0.00, whatever its average cost", () => {
    fc.assert(
      fc.property(unitCost, (cost) => {
        expect(stockValue(0, cost)).toBe(0n);
      }),
    );
  });

  it("a stock's value is within half a cent of on hand × average cost, and the opposite stock has the opposite value", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        unitCost,
        (onHand, cost) => {
          const cents = stockValue(onHand, cost);
          // In millionths: a cent is 10 000 of them.
          const exact = BigInt(onHand) * cost;
          const off = cents * 10_000n - exact;
          expect(off <= 5000n && off >= -5000n).toBe(true);
          expect(stockValue(-onHand, cost)).toBe(-cents);
        },
      ),
    );
  });

  it("each storeroom is worth the sum of its places' values, and the total is the sum of the storerooms'", () => {
    fc.assert(
      fc.property(movementList, (ms) => {
        const result = valuation(ms);
        for (const [storeroomId, worth] of result.storerooms) {
          expect(worth).toBe(
            sumMoney(
              result.places
                .filter((p) => p.storeroomId === storeroomId)
                .map((p) => p.value),
            ),
          );
        }
        expect(result.total).toBe(sumMoney([...result.storerooms.values()]));
        expect(new Set(result.storerooms.keys())).toEqual(
          new Set(result.places.map((p) => p.storeroomId)),
        );
      }),
    );
  });

  it("every place with movements is listed once, with the stock stockOnHand gives, the cost averageCost gives, and their value", () => {
    fc.assert(
      fc.property(movementList, (ms) => {
        const result = valuation(ms);
        const moved = new Set(ms.map((m) => `${m.productId}/${m.storeroomId}`));
        expect(
          result.places.map((p) => `${p.productId}/${p.storeroomId}`).sort(),
        ).toEqual([...moved].sort());
        for (const p of result.places) {
          const onHand = stockOnHand(ms, p.productId, p.storeroomId);
          const cost = averageCost(ms, p.productId, p.storeroomId);
          expect(p.onHand).toBe(onHand);
          expect(p.averageCost).toBe(cost);
          expect(p.value).toBe(stockValue(onHand, cost));
        }
      }),
    );
  });
});
