import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { averageCost, latestPurchasePrice, receivedUnitCost } from "./cost";
import {
  formatUnitCost,
  parseMoney,
  parseUnitCost,
  unitCostFromMillionths,
  type UnitCost,
} from "./money";
import { reverseMovement, type Movement, type MovementKind } from "./movement";

const PRODUCTS = ["tomatoes", "eggs"];
const STOREROOMS = ["cold-room", "dry-store"];
const everyLocation = PRODUCTS.flatMap((p) =>
  STOREROOMS.map((s) => [p, s] as const),
);

/** Freezes a list and every movement in it, so any attempt to change them throws. */
function frozen(movements: Movement[]): readonly Movement[] {
  return Object.freeze(movements.map((m) => Object.freeze({ ...m })));
}

type Step = Pick<Movement, "kind" | "quantity"> &
  Partial<Omit<Movement, "unitCost">> & { cost: string };

/**
 * Movements of tomatoes in the cold room unless a step says otherwise, with IDs in list order:
 * m1, m2, …
 */
function history(...steps: Step[]): readonly Movement[] {
  return frozen(
    steps.map(({ cost, ...step }, i) => ({
      id: `m${i + 1}`,
      productId: "tomatoes",
      storeroomId: "cold-room",
      documentLineId: `line${i + 1}`,
      unitCost: parseUnitCost(cost),
      ...step,
    })),
  );
}

const cost = (m: readonly Movement[], p = "tomatoes", s = "cold-room") =>
  averageCost(m, p, s);

describe("receivedUnitCost: line total ÷ quantity in base units, rounded to 6 decimals", () => {
  it("€4.80 for 2500 g: €0.001920 per gram", () => {
    expect(receivedUnitCost(parseMoney("4.80"), 2500)).toBe(
      parseUnitCost("0.00192"),
    );
  });

  it("€1.00 for 3000 g: €0.000333 (0.0003333… rounded down)", () => {
    expect(receivedUnitCost(parseMoney("1.00"), 3000)).toBe(
      parseUnitCost("0.000333"),
    );
  });

  it("€2.00 for 3000 g: €0.000667 (0.0006666… rounded up)", () => {
    expect(receivedUnitCost(parseMoney("2.00"), 3000)).toBe(
      parseUnitCost("0.000667"),
    );
  });

  it("€0.01 for 20 000 g: €0.000001 (exactly half a millionth, rounded away from zero)", () => {
    expect(receivedUnitCost(parseMoney("0.01"), 20_000)).toBe(
      parseUnitCost("0.000001"),
    );
  });

  it("a return, −€4.00 for −2000 g: €0.002000, a positive cost", () => {
    expect(receivedUnitCost(parseMoney("-4.00"), -2000)).toBe(
      parseUnitCost("0.002"),
    );
    // The tie rule is the same for returns: away from zero, so up to €0.000001.
    expect(receivedUnitCost(parseMoney("-0.01"), -20_000)).toBe(
      parseUnitCost("0.000001"),
    );
  });

  it("free goods, €0.00 for 1000 g: €0", () => {
    expect(receivedUnitCost(parseMoney("0.00"), 1000)).toBe(parseUnitCost("0"));
  });

  it("rejects a quantity of 0", () => {
    expect(() => receivedUnitCost(parseMoney("1.00"), 0)).toThrow(RangeError);
  });

  it("rejects a total and a quantity with opposite signs: a cost can't be negative", () => {
    expect(() => receivedUnitCost(parseMoney("-1.00"), 1000)).toThrow(
      RangeError,
    );
    expect(() => receivedUnitCost(parseMoney("1.00"), -1000)).toThrow(
      RangeError,
    );
  });

  it("rejects a quantity that isn't a whole number of base units", () => {
    expect(() => receivedUnitCost(parseMoney("1.00"), 2.5)).toThrow(RangeError);
  });
});

describe("averageCost: weighted average per product and storeroom, by replaying movements", () => {
  it("10 kg at €2.00/kg, then 5 kg at €3.20/kg: €2.40/kg (€0.0024 per gram)", () => {
    // (10 000 × 0.002 + 5000 × 0.0032) ÷ 15 000 = (20 + 16) ÷ 15 000 = 0.0024
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "receipt", quantity: 5000, cost: "0.0032" },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.0024"));
  });

  it("no movements: €0, stock with no recorded cost", () => {
    expect(cost([])).toBe(parseUnitCost("0"));
  });

  it("rounds at each recalculation: 1000 g at €0.001, then 2000 g at €0.002 is €0.001667", () => {
    // (1 + 4) ÷ 3000 = 0.0016666…
    const ms = history(
      { kind: "receipt", quantity: 1000, cost: "0.001" },
      { kind: "receipt", quantity: 2000, cost: "0.002" },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.001667"));
  });

  it("waste leaves the average as it was, whatever cost it carries; it only lowers the stock the next receipt is weighed against", () => {
    // After the waste: 6000 g at 0.002. Then (6000 × 0.002 + 6000 × 0.0032) ÷ 12 000 = 0.0026.
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "waste", quantity: -4000, cost: "9.99" },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.002"));
    const more = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "waste", quantity: -4000, cost: "9.99" },
      { kind: "receipt", quantity: 6000, cost: "0.0032" },
    );
    expect(cost(more)).toBe(parseUnitCost("0.0026"));
  });

  it("count gains and losses, transfers out and returns to the supplier leave the average as it was", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "count", quantity: 500, cost: "0.005" },
      { kind: "count", quantity: -300, cost: "0.005" },
      { kind: "transfer-out", quantity: -1000, cost: "0.005" },
      { kind: "receipt", quantity: -2000, cost: "0.003" },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.002"));
  });

  it("stock back to 0: the next receipt sets the average to its own cost, €3.20/kg", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "waste", quantity: -10_000, cost: "0.002" },
      { kind: "receipt", quantity: 5000, cost: "0.0032" },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.0032"));
  });

  it("stock below 0 (a flagged adjustment): the next receipt sets the average to its own cost", () => {
    const ms = history(
      { kind: "receipt", quantity: 1000, cost: "0.002" },
      { kind: "waste", quantity: -2000, cost: "0.002", adjustment: true },
      { kind: "receipt", quantity: 5000, cost: "0.0032" },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.0032"));
  });

  it("a transfer carries the cold room's €2.40/kg into a dry store holding 5 kg at €2.00/kg: €2.20/kg there", () => {
    // Dry store: (5000 × 0.002 + 5000 × 0.0024) ÷ 10 000 = (10 + 12) ÷ 10 000 = 0.0022
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "receipt", quantity: 5000, cost: "0.0032" },
      {
        kind: "receipt",
        quantity: 5000,
        cost: "0.002",
        storeroomId: "dry-store",
      },
    );
    const average = cost(ms);
    expect(average).toBe(parseUnitCost("0.0024"));

    const transferred = [
      ...ms,
      {
        id: "out",
        productId: "tomatoes",
        storeroomId: "cold-room",
        quantity: -5000,
        unitCost: average,
        documentLineId: "transfer-1/line-1",
        kind: "transfer-out",
      },
      {
        id: "in",
        productId: "tomatoes",
        storeroomId: "dry-store",
        quantity: 5000,
        unitCost: average,
        documentLineId: "transfer-1/line-1",
        kind: "transfer-in",
      },
    ] satisfies Movement[];
    expect(cost(transferred, "tomatoes", "dry-store")).toBe(
      parseUnitCost("0.0022"),
    );
    expect(cost(transferred, "tomatoes", "cold-room")).toBe(
      parseUnitCost("0.0024"),
    );
  });

  it("a wrong receipt and its reversal leave no trace: €2.00, then the corrected receipt gives exactly €2.10", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "receipt", quantity: 10_000, cost: "0.004" },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.003"));
    const reversal = reverseMovement(ms[1]!, ms, {
      id: "r",
      documentLineId: "reversal",
    });
    const corrected = [...ms, reversal];
    expect(cost(corrected)).toBe(parseUnitCost("0.002"));
    // (10 000 × 0.002 + 10 000 × 0.0022) ÷ 20 000 = 0.0021
    const withNew = [
      ...corrected,
      { ...ms[1]!, id: "new", unitCost: parseUnitCost("0.0022") },
    ];
    expect(cost(withNew)).toBe(parseUnitCost("0.0021"));
  });

  it("counts only its own product and storeroom", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "receipt", quantity: 10_000, cost: "0.9", productId: "eggs" },
      {
        kind: "receipt",
        quantity: 10_000,
        cost: "0.9",
        storeroomId: "dry-store",
      },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.002"));
  });
});

describe("latestPurchasePrice: for recipe costing, a separate function from the average", () => {
  it("€2.00/kg in the cold room, then €3.20/kg in the dry store: €3.20/kg, whichever storeroom", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      {
        kind: "receipt",
        quantity: 5000,
        cost: "0.0032",
        storeroomId: "dry-store",
      },
    );
    expect(latestPurchasePrice(ms, "tomatoes")).toBe(parseUnitCost("0.0032"));
  });

  it("if the latest receipt was reversed, the one before it", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "receipt", quantity: 5000, cost: "0.0032" },
    );
    const reversal = reverseMovement(ms[1]!, ms, {
      id: "r",
      documentLineId: "reversal",
    });
    expect(latestPurchasePrice([...ms, reversal], "tomatoes")).toBe(
      parseUnitCost("0.002"),
    );
  });

  it("returns, transfers in, counts and other products aren't purchases", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "receipt", quantity: -1000, cost: "0.009" },
      { kind: "transfer-in", quantity: 1000, cost: "0.009" },
      { kind: "count", quantity: 1000, cost: "0.009" },
      { kind: "receipt", quantity: 1000, cost: "0.009", productId: "eggs" },
    );
    expect(latestPurchasePrice(ms, "tomatoes")).toBe(parseUnitCost("0.002"));
  });

  it("reversing a return doesn't make it a purchase", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "receipt", quantity: -1000, cost: "0.009" },
    );
    const reversal = reverseMovement(ms[1]!, ms, {
      id: "r",
      documentLineId: "reversal",
    });
    expect(latestPurchasePrice([...ms, reversal], "tomatoes")).toBe(
      parseUnitCost("0.002"),
    );
  });

  it("never bought: undefined, so an uncosted recipe shows up instead of looking free", () => {
    expect(latestPurchasePrice([], "tomatoes")).toBeUndefined();
  });
});

describe("corrections (decision 0032): a receipt correcting another counts in its place", () => {
  // 10 kg at €1.80/kg, 6 kg used, 4 kg at €2.50/kg; then an invoice says €2.00/kg for the first
  // 10 kg: a receipt at €0.002 correcting m1 (m4), and m1's reversal (m5).
  const corrected = history(
    { kind: "receipt", quantity: 10_000, cost: "0.0018" },
    { kind: "waste", quantity: -6000, cost: "0.0018" },
    { kind: "receipt", quantity: 4000, cost: "0.0025" },
    { kind: "receipt", quantity: 10_000, cost: "0.002", corrects: "m1" },
    { kind: "receipt", quantity: -10_000, cost: "0.0018", reverses: "m1" },
  );

  it("the average is (4000 × 0.002 + 4000 × 0.0025) ÷ 8000 = €0.002250, as if m1 had been €0.002; counted last it would be €0.002000", () => {
    expect(cost(corrected)).toBe(parseUnitCost("0.00225"));
  });

  it("the latest purchase price stays m3's €0.0025: a correction takes the place of an older receipt", () => {
    expect(latestPurchasePrice(corrected, "tomatoes")).toBe(
      parseUnitCost("0.0025"),
    );
  });

  it("a correction of the correction: the last in the chain counts, still in m1's place, (4000 × 0.0019 + 4000 × 0.0025) ÷ 8000 = €0.0022", () => {
    const again = history(
      ...corrected.map(({ unitCost, ...m }) => ({
        ...m,
        cost: formatUnitCost(unitCost),
      })),
      { kind: "receipt", quantity: 10_000, cost: "0.0019", corrects: "m4" },
      { kind: "receipt", quantity: -10_000, cost: "0.002", reverses: "m4" },
    );
    expect(cost(again)).toBe(parseUnitCost("0.0022"));
  });

  it("a correction whose receipt isn't in the list counts where it is", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      {
        kind: "receipt",
        quantity: 10_000,
        cost: "0.004",
        corrects: "elsewhere",
      },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.003"));
    expect(latestPurchasePrice(ms, "tomatoes")).toBe(parseUnitCost("0.004"));
  });

  it("a receipt whose correction was itself reversed with nothing after it counts nothing", () => {
    const ms = history(
      { kind: "receipt", quantity: 10_000, cost: "0.002" },
      { kind: "receipt", quantity: 10_000, cost: "0.003" },
      { kind: "receipt", quantity: 10_000, cost: "0.004", corrects: "m2" },
      { kind: "receipt", quantity: -10_000, cost: "0.003", reverses: "m2" },
      { kind: "receipt", quantity: -10_000, cost: "0.004", reverses: "m3" },
    );
    expect(cost(ms)).toBe(parseUnitCost("0.002"));
    expect(latestPurchasePrice(ms, "tomatoes")).toBe(parseUnitCost("0.002"));
  });
});

const unitCost = fc
  .bigInt({ min: 0n, max: 10n ** 7n })
  .map(unitCostFromMillionths);
const KINDS: readonly MovementKind[] = [
  "receipt",
  "waste",
  "count",
  "transfer-out",
  "transfer-in",
];

// Any movements in a few locations, in and out, with unique IDs and no reversals.
const movementList = fc
  .array(
    fc.record({
      productId: fc.constantFrom(...PRODUCTS),
      storeroomId: fc.constantFrom(...STOREROOMS),
      quantity: fc.integer({ min: -1_000_000, max: 1_000_000 }),
      unitCost,
      kind: fc.constantFrom(...KINDS),
    }),
    { maxLength: 40 },
  )
  .map((fields) =>
    frozen(
      fields.map((f, i) => ({ ...f, id: `m${i}`, documentLineId: `line${i}` })),
    ),
  );
const nonEmptyMovementList = movementList.filter((ms) => ms.length > 0);

/** Every location's average cost, as `product/storeroom → millionths`. */
function allCosts(ms: readonly Movement[]): Record<string, UnitCost> {
  return Object.fromEntries(
    everyLocation.map(([p, s]) => [`${p}/${s}`, averageCost(ms, p, s)]),
  );
}

describe("average cost properties", () => {
  it("invariant 5 (cost): replaying the same movements in the same order gives the same average cost for every product and storeroom, also from a fresh copy", () => {
    fc.assert(
      fc.property(movementList, (ms) => {
        const first = allCosts(ms);
        expect(allCosts(ms)).toEqual(first);
        expect(allCosts(structuredClone([...ms]))).toEqual(first);
      }),
    );
  });

  it("while stock stays positive, the average always lies between the lowest and highest unit cost that came in", () => {
    // One location. Each step is a receipt or a transfer in, or something going out that never
    // takes more than leaves 1 g, so stock stays positive after the first receipt.
    const step = fc.record({
      incoming: fc.boolean(),
      kind: fc.constantFrom<MovementKind>("receipt", "transfer-in"),
      outKind: fc.constantFrom<MovementKind>(
        "waste",
        "count",
        "transfer-out",
        "receipt",
      ),
      quantity: fc.integer({ min: 1, max: 1_000_000 }),
      unitCost,
    });
    fc.assert(
      fc.property(
        fc.record({
          quantity: fc.integer({ min: 1, max: 1_000_000 }),
          unitCost,
        }),
        fc.array(step, { maxLength: 40 }),
        (first, steps) => {
          const ms: Movement[] = [];
          const add = (
            kind: MovementKind,
            quantity: number,
            cost: UnitCost,
          ) => {
            ms.push({
              id: `m${ms.length}`,
              productId: "tomatoes",
              storeroomId: "cold-room",
              quantity,
              unitCost: cost,
              documentLineId: `line${ms.length}`,
              kind,
            });
          };
          add("receipt", first.quantity, first.unitCost);
          let stock = first.quantity;
          const costsIn = [first.unitCost];
          for (const s of steps) {
            if (s.incoming) {
              add(s.kind, s.quantity, s.unitCost);
              stock += s.quantity;
              costsIn.push(s.unitCost);
            } else if (stock > 1) {
              // Out at any cost: outgoing costs don't count as "came in".
              const out = 1 + (s.quantity % (stock - 1));
              add(s.outKind, -out, s.unitCost);
              stock -= out;
            }
            expect(stock).toBeGreaterThan(0);
            const average = averageCost(ms, "tomatoes", "cold-room");
            const lowest = costsIn.reduce((a, b) => (a < b ? a : b));
            const highest = costsIn.reduce((a, b) => (a > b ? a : b));
            expect(average >= lowest && average <= highest).toBe(true);
          }
        },
      ),
    );
  });

  it("waste, transfers out and count losses never change the average, whatever unit cost they carry", () => {
    fc.assert(
      fc.property(
        movementList,
        fc.constantFrom(...PRODUCTS),
        fc.constantFrom(...STOREROOMS),
        fc.constantFrom<MovementKind>("waste", "transfer-out", "count"),
        fc.integer({ min: -1_000_000, max: -1 }),
        unitCost,
        (ms, productId, storeroomId, kind, quantity, cost) => {
          const out: Movement = {
            id: "out",
            productId,
            storeroomId,
            quantity,
            unitCost: cost,
            documentLineId: "out-line",
            kind,
          };
          expect(allCosts([...ms, out])).toEqual(allCosts(ms));
        },
      ),
    );
  });

  it("invariant 3 (cost): a movement and its reversal together leave the average exactly as if neither had been posted", () => {
    fc.assert(
      fc.property(nonEmptyMovementList, fc.nat(), (ms, pick) => {
        const original = ms[pick % ms.length]!;
        const reversal = reverseMovement(original, ms, {
          id: "r",
          documentLineId: "rl",
        });
        expect(allCosts([...ms, reversal])).toEqual(
          allCosts(ms.filter((m) => m !== original)),
        );
      }),
    );
  });
});
