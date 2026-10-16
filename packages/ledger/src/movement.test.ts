import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseUnitCost, unitCostFromMillionths } from "./money";
import {
  appendMovements,
  applyMovement,
  balancesOf,
  findBalanceMismatches,
  flaggedAdjustments,
  reverseMovement,
  stockOnHand,
  type Balances,
  type Movement,
  type MovementKind,
} from "./movement";

const KINDS: readonly MovementKind[] = [
  "receipt",
  "waste",
  "count",
  "transfer-out",
  "transfer-in",
];
const PRODUCTS = ["tomatoes", "eggs", "wine"];
const STOREROOMS = ["cold-room", "dry-store"];

/** Freezes a list and every movement in it, so any attempt to change them throws. */
function frozen(movements: Movement[]): readonly Movement[] {
  return Object.freeze(movements.map((m) => Object.freeze({ ...m })));
}

// Any list of movements: a few products and storerooms, so they share locations, with
// quantities in and out. IDs are unique, as the ledger requires.
const movementList = fc
  .array(
    fc.record({
      productId: fc.constantFrom(...PRODUCTS),
      storeroomId: fc.constantFrom(...STOREROOMS),
      quantity: fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
      unitCost: fc
        .bigInt({ min: 0n, max: 10n ** 9n })
        .map(unitCostFromMillionths),
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

/** Every product and storeroom pair, including ones without movements (stock 0). */
const everyLocation = PRODUCTS.flatMap((p) =>
  STOREROOMS.map((s) => [p, s] as const),
);

// Example movements, computed by hand: tomatoes in the cold room.
const receipt: Movement = {
  id: "m1",
  productId: "tomatoes",
  storeroomId: "cold-room",
  quantity: 6000,
  unitCost: parseUnitCost("0.0025"),
  documentLineId: "delivery-note-1/line-1",
  kind: "receipt",
};
const waste: Movement = {
  id: "m2",
  productId: "tomatoes",
  storeroomId: "cold-room",
  quantity: -250,
  unitCost: parseUnitCost("0.0025"),
  documentLineId: "waste-1/line-1",
  kind: "waste",
};
const elsewhere: Movement[] = [
  { ...receipt, id: "m3", storeroomId: "dry-store", quantity: 1000 },
  { ...receipt, id: "m4", productId: "eggs", quantity: 30_000 },
];
const examples = frozen([receipt, waste, ...elsewhere]);

describe("stockOnHand: the sum of a product's movements in a storeroom", () => {
  it("6000 g received, 250 g wasted: 5750 g, counting nothing from other products or storerooms", () => {
    expect(stockOnHand(examples, "tomatoes", "cold-room")).toBe(5750);
    expect(stockOnHand(examples, "tomatoes", "dry-store")).toBe(1000);
    expect(stockOnHand(examples, "eggs", "cold-room")).toBe(30_000);
  });

  it("no movements: 0", () => {
    expect(stockOnHand([], "tomatoes", "cold-room")).toBe(0);
    expect(stockOnHand(examples, "wine", "cold-room")).toBe(0);
  });

  it("throws instead of losing precision when the sum is too large to be exact", () => {
    const huge = { ...receipt, quantity: Number.MAX_SAFE_INTEGER };
    expect(() =>
      stockOnHand([huge, { ...huge, id: "m9" }], "tomatoes", "cold-room"),
    ).toThrow(RangeError);
  });

  it("stock on hand doesn't depend on the order of the movements", () => {
    fc.assert(
      fc.property(
        movementList.chain((ms) =>
          fc.tuple(
            fc.constant(ms),
            fc.shuffledSubarray([...ms], {
              minLength: ms.length,
              maxLength: ms.length,
            }),
          ),
        ),
        ([ms, shuffled]) => {
          for (const [p, s] of everyLocation) {
            expect(stockOnHand(shuffled, p, s)).toBe(stockOnHand(ms, p, s));
          }
        },
      ),
    );
  });
});

describe("balances: every product's stock in every storeroom", () => {
  it("lists each product and storeroom that has movements", () => {
    const balances = balancesOf(examples);
    expect(balances.get("tomatoes")?.get("cold-room")).toBe(5750);
    expect(balances.get("tomatoes")?.get("dry-store")).toBe(1000);
    expect(balances.get("eggs")?.get("cold-room")).toBe(30_000);
    expect(balances.get("wine")).toBeUndefined();
  });

  it("applyMovement returns new balances and leaves the old ones as they were", () => {
    const before = balancesOf([receipt]);
    const after = applyMovement(before, waste);
    expect(after.get("tomatoes")?.get("cold-room")).toBe(5750);
    expect(before.get("tomatoes")?.get("cold-room")).toBe(6000);
  });

  it("findBalanceMismatches: a cached 5000 g against 5750 g in the movements is reported", () => {
    const cached: Balances = new Map([
      [
        "tomatoes",
        new Map([
          ["cold-room", 5000],
          ["dry-store", 1000],
        ]),
      ],
      ["eggs", new Map([["cold-room", 30_000]])],
    ]);
    expect(findBalanceMismatches(cached, examples)).toEqual([
      {
        productId: "tomatoes",
        storeroomId: "cold-room",
        cached: 5000,
        actual: 5750,
      },
    ]);
  });

  it("findBalanceMismatches: a location missing from either side counts as 0", () => {
    const cached: Balances = new Map([["wine", new Map([["dry-store", 750]])]]);
    expect(findBalanceMismatches(cached, [waste])).toEqual([
      {
        productId: "tomatoes",
        storeroomId: "cold-room",
        cached: 0,
        actual: -250,
      },
      { productId: "wine", storeroomId: "dry-store", cached: 750, actual: 0 },
    ]);
  });

  it("findBalanceMismatches: sorted by product, then storeroom, whatever order the cached balances are in", () => {
    const cached: Balances = new Map([
      ["wine", new Map([["dry-store", 1]])],
      [
        "eggs",
        new Map([
          ["dry-store", 2],
          ["cold-room", 3],
        ]),
      ],
      ["tomatoes", new Map([["cold-room", 4]])],
    ]);
    expect(
      findBalanceMismatches(cached, []).map(
        (m) => `${m.productId}/${m.storeroomId}`,
      ),
    ).toEqual([
      "eggs/cold-room",
      "eggs/dry-store",
      "tomatoes/cold-room",
      "wine/dry-store",
    ]);
  });

  it("invariant 1: applying movements one at a time to a running balance always gives the same stock as adding them all up from scratch", () => {
    fc.assert(
      fc.property(movementList, (ms) => {
        let running: Balances = new Map();
        for (const m of ms) {
          running = applyMovement(running, m);
          // After every step, not just at the end.
          const sofar = ms.slice(0, ms.indexOf(m) + 1);
          expect(running.get(m.productId)?.get(m.storeroomId)).toBe(
            stockOnHand(sofar, m.productId, m.storeroomId),
          );
        }
        for (const [p, s] of everyLocation) {
          expect(running.get(p)?.get(s) ?? 0).toBe(stockOnHand(ms, p, s));
        }
      }),
    );
  });

  it("invariant 1: a cached balance that matches the movements reports no mismatch, and changing one cached figure reports exactly that product and storeroom", () => {
    fc.assert(
      fc.property(
        nonEmptyMovementList,
        fc.nat(),
        fc.integer({ min: 1, max: 1000 }),
        (ms, pick, delta) => {
          const cached = balancesOf(ms);
          expect(findBalanceMismatches(cached, ms)).toEqual([]);

          const m = ms[pick % ms.length]!;
          const actual = stockOnHand(ms, m.productId, m.storeroomId);
          const wrong = new Map(cached);
          wrong.set(
            m.productId,
            new Map(cached.get(m.productId)).set(m.storeroomId, actual + delta),
          );
          expect(findBalanceMismatches(wrong, ms)).toEqual([
            {
              productId: m.productId,
              storeroomId: m.storeroomId,
              cached: actual + delta,
              actual,
            },
          ]);
        },
      ),
    );
  });

  it("invariant 5: replaying the same movements in the same order gives the same stock for every product and storeroom, also from a fresh copy", () => {
    fc.assert(
      fc.property(movementList, (ms) => {
        const first = balancesOf(ms);
        expect(balancesOf(ms)).toEqual(first);
        expect(balancesOf(structuredClone([...ms]))).toEqual(first);
      }),
    );
  });
});

describe("reverseMovement: the movement that cancels another", () => {
  it("reversing the 250 g of waste: +250 g of waste, same product, storeroom and unit cost, on the reversing document's line", () => {
    const reversal = reverseMovement(waste, examples, {
      id: "m5",
      documentLineId: "waste-1-reversal/line-1",
    });
    expect(reversal).toEqual({
      id: "m5",
      productId: "tomatoes",
      storeroomId: "cold-room",
      quantity: 250,
      unitCost: parseUnitCost("0.0025"),
      documentLineId: "waste-1-reversal/line-1",
      kind: "waste",
      reverses: "m2",
    });
    expect(stockOnHand([...examples, reversal], "tomatoes", "cold-room")).toBe(
      6000,
    );
  });

  it("rejects reversing a reversal: post a new movement instead", () => {
    const reversal = reverseMovement(waste, examples, {
      id: "m5",
      documentLineId: "r1",
    });
    expect(() =>
      reverseMovement(reversal, [...examples, reversal], {
        id: "m6",
        documentLineId: "r2",
      }),
    ).toThrow("movement m5 is itself a reversal (of m2)");
  });

  it("rejects reversing a movement twice", () => {
    const reversal = reverseMovement(waste, examples, {
      id: "m5",
      documentLineId: "r1",
    });
    expect(() =>
      reverseMovement(waste, [...examples, reversal], {
        id: "m6",
        documentLineId: "r2",
      }),
    ).toThrow("movement m2 is already reversed by m5");
  });

  it("rejects an id that is already used", () => {
    expect(() =>
      reverseMovement(waste, examples, { id: "m1", documentLineId: "r1" }),
    ).toThrow("id m1 is already used");
  });

  it("rejects a movement that isn't in the movements given", () => {
    expect(() =>
      reverseMovement({ ...waste, id: "m99" }, examples, {
        id: "m5",
        documentLineId: "r1",
      }),
    ).toThrow("movement m99 is not in the movements given");
  });

  it("invariant 3: a movement and its reversal together leave stock exactly as it was without either", () => {
    fc.assert(
      fc.property(nonEmptyMovementList, fc.nat(), (ms, pick) => {
        const original = ms[pick % ms.length]!;
        const reversal = reverseMovement(original, ms, {
          id: "r",
          documentLineId: "rl",
        });
        const withBoth = [...ms, reversal];
        const withNeither = ms.filter((m) => m !== original);
        for (const [p, s] of everyLocation) {
          expect(stockOnHand(withBoth, p, s)).toBe(
            stockOnHand(withNeither, p, s),
          );
        }
      }),
    );
  });

  it("invariant 3: reversing a movement never changes the original or the existing list", () => {
    fc.assert(
      fc.property(nonEmptyMovementList, fc.nat(), (ms, pick) => {
        const before = structuredClone([...ms]);
        // The list and its movements are frozen: changing them would throw here.
        reverseMovement(ms[pick % ms.length]!, ms, {
          id: "r",
          documentLineId: "rl",
        });
        expect(ms).toEqual(before);
      }),
    );
  });
});

describe("appendMovements: negative stock only through a flagged adjustment (invariant 6)", () => {
  // 6000 g of tomatoes in the cold room, 0 in the dry store.
  const stocked = frozen([receipt]);

  it("6000 g on hand: wasting 6000 g is accepted and leaves 0", () => {
    const all = appendMovements(stocked, [{ ...waste, quantity: -6000 }]);
    expect(all).toEqual([receipt, { ...waste, quantity: -6000 }]);
    expect(stockOnHand(all, "tomatoes", "cold-room")).toBe(0);
  });

  it("6000 g on hand: wasting 6001 g is rejected, naming the movement and the stock it would leave", () => {
    expect(() =>
      appendMovements(stocked, [{ ...waste, quantity: -6001 }]),
    ).toThrow(
      "movement m2 would take stock of product tomatoes in storeroom cold-room to -1",
    );
  });

  it("the same waste as a flagged adjustment is accepted, and reports list it", () => {
    const flagged: Movement = { ...waste, quantity: -6001, adjustment: true };
    const all = appendMovements(stocked, [flagged]);
    expect(stockOnHand(all, "tomatoes", "cold-room")).toBe(-1);
    expect(flaggedAdjustments(all)).toEqual([flagged]);
  });

  it("checks the new movements in order: taking stock out before it comes in is rejected", () => {
    const fromDryStore = { ...waste, storeroomId: "dry-store", quantity: -500 };
    const into = {
      ...receipt,
      id: "m3",
      storeroomId: "dry-store",
      quantity: 500,
    };
    expect(appendMovements(stocked, [into, fromDryStore])).toHaveLength(3);
    expect(() => appendMovements(stocked, [fromDryStore, into])).toThrow(
      "movement m2 would take stock of product tomatoes in storeroom dry-store to -500",
    );
  });

  it("stock coming in is always accepted, even if it leaves stock below zero", () => {
    const below = frozen([
      { ...waste, id: "m1", quantity: -1000, adjustment: true },
    ]);
    const all = appendMovements(below, [
      { ...receipt, id: "m2", quantity: 400 },
    ]);
    expect(stockOnHand(all, "tomatoes", "cold-room")).toBe(-600);
  });

  it("an unflagged movement taking stock further below zero is rejected", () => {
    const below = frozen([
      { ...waste, id: "m1", quantity: -1000, adjustment: true },
    ]);
    expect(() =>
      appendMovements(below, [{ ...waste, id: "m2", quantity: -1 }]),
    ).toThrow("to -1001");
  });

  it("reversing a receipt whose stock was already used is rejected: post the correction first", () => {
    const used = frozen([receipt, { ...waste, quantity: -5000 }]);
    const reversal = reverseMovement(receipt, used, {
      id: "m3",
      documentLineId: "delivery-note-1-reversal/line-1",
    });
    expect(reversal.adjustment).toBeUndefined();
    expect(() => appendMovements(used, [reversal])).toThrow("to -5000");
  });

  it("flaggedAdjustments: none flagged, none listed", () => {
    expect(flaggedAdjustments(examples)).toEqual([]);
  });
});

// Any movements in one location, some flagged, with quantities skewed so that stock often
// goes below zero.
const appendCase = fc
  .tuple(
    fc.array(
      fc.record({
        quantity: fc.integer({ min: -1000, max: 800 }),
        adjustment: fc.boolean(),
      }),
      { maxLength: 30 },
    ),
    fc.nat(),
  )
  .map(([fields, split]) => {
    const all = fields.map(({ quantity, adjustment }, i): Movement => ({
      id: `m${i}`,
      productId: "tomatoes",
      storeroomId: "cold-room",
      quantity,
      unitCost: parseUnitCost("0.002"),
      documentLineId: `line${i}`,
      kind: quantity >= 0 ? "receipt" : "waste",
      ...(adjustment ? { adjustment: true as const } : {}),
    }));
    const at = all.length === 0 ? 0 : split % (all.length + 1);
    return { existing: frozen(all.slice(0, at)), added: frozen(all.slice(at)) };
  });

describe("invariant 6 properties", () => {
  it("invariant 6: whatever is appended, stock only goes below zero, or further below, through a flagged adjustment", () => {
    fc.assert(
      fc.property(appendCase, ({ existing, added }) => {
        // Worked out independently: the stock after each new movement, from scratch.
        const breaksTheRule = added.some(
          (m, i) =>
            m.quantity < 0 &&
            m.adjustment !== true &&
            stockOnHand(
              [...existing, ...added.slice(0, i + 1)],
              m.productId,
              m.storeroomId,
            ) < 0,
        );
        if (breaksTheRule) {
          expect(() => appendMovements(existing, added)).toThrow(
            /would take stock/,
          );
        } else {
          expect(appendMovements(existing, added)).toEqual([
            ...existing,
            ...added,
          ]);
        }
      }),
    );
  });

  it("invariant 6: when appendMovements rejects, nothing is added and the existing list is unchanged", () => {
    fc.assert(
      fc.property(appendCase, ({ existing, added }) => {
        const before = structuredClone([...existing]);
        // The lists and their movements are frozen: changing them would throw a TypeError.
        try {
          appendMovements(existing, added);
        } catch (error) {
          expect(error).not.toBeInstanceOf(TypeError);
        }
        expect(existing).toEqual(before);
      }),
    );
  });

  it("invariant 6: flaggedAdjustments lists exactly the flagged movements, in order", () => {
    fc.assert(
      fc.property(appendCase, ({ existing, added }) => {
        const all = [...existing, ...added];
        const listed = flaggedAdjustments(all);
        let flagged = 0;
        for (const m of all) if (m.adjustment === true) flagged++;
        expect(listed).toHaveLength(flagged);
        expect(listed.every((m) => m.adjustment === true)).toBe(true);
        const positions = listed.map((m) => all.indexOf(m));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
      }),
    );
  });
});
