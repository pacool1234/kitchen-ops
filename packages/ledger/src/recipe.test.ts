import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatFixed } from "./fixed-point";
import {
  grossQuantity,
  theoreticalUse,
  type Recipe,
  type SaleLine,
} from "./recipe";

describe("grossQuantity: net ÷ yield, rounded to whole base units", () => {
  it("150 g of fish at 60% yield draws 250 g", () => {
    expect(grossQuantity(150, "60")).toBe(250);
  });

  it("100 g at 60%: 166.67 g, rounded to 167 g", () => {
    expect(grossQuantity(100, "60")).toBe(167);
  });

  it("101 g at 60%: 168.33 g, rounded to 168 g", () => {
    expect(grossQuantity(101, "60")).toBe(168);
  });

  it("1 g at 40%: exactly 2.5 g, rounded away from zero to 3 g", () => {
    expect(grossQuantity(1, "40")).toBe(3);
  });

  it("a yield with decimals: 125 g at 62.5% draws 200 g", () => {
    expect(grossQuantity(125, "62.5")).toBe(200);
  });

  it("above 100%: 150 g of cooked rice at 250% draws 60 g of dry rice", () => {
    expect(grossQuantity(150, "250")).toBe(60);
  });

  it("no yield means 100%: the net quantity", () => {
    expect(grossQuantity(150)).toBe(150);
  });

  it("rejects a yield of 0 or below", () => {
    expect(() => grossQuantity(150, "0")).toThrow(RangeError);
    expect(() => grossQuantity(150, "-60")).toThrow(RangeError);
  });

  it("rejects a yield with more than 2 decimals, instead of rounding it", () => {
    expect(() => grossQuantity(150, "62.555")).toThrow(RangeError);
  });

  it("rejects a net quantity that is negative or not a whole number of base units", () => {
    expect(() => grossQuantity(-1, "60")).toThrow(RangeError);
    expect(() => grossQuantity(1.5, "60")).toThrow(RangeError);
  });
});

// Fish at 60% (150 g net draws 250 g), and a salad with 360 g of tomatoes at 90% (400 g) plus
// 20 g of oil with no yield.
const recipes: readonly Recipe[] = [
  {
    posProductCode: "FISH",
    lines: [{ productId: "hake", netQuantity: 150, yieldPercent: "60" }],
  },
  {
    posProductCode: "SALAD",
    lines: [
      { productId: "tomatoes", netQuantity: 360, yieldPercent: "90" },
      { productId: "oil", netQuantity: 20 },
    ],
  },
  {
    posProductCode: "FISH-SALAD",
    lines: [
      { productId: "hake", netQuantity: 75, yieldPercent: "60" },
      { productId: "tomatoes", netQuantity: 180, yieldPercent: "90" },
    ],
  },
];

describe("theoreticalUse: Σ dishes sold × gross recipe quantity", () => {
  it("40 fish dishes × 250 g: 10 000 g of hake", () => {
    const { use } = theoreticalUse(
      [{ posProductCode: "FISH", quantity: 40 }],
      recipes,
    );
    expect(use).toEqual(new Map([["hake", 10_000]]));
  });

  it("dishes sharing a product add up: 10 fish (2500 g) + 4 fish salads (4 × 125 g = 500 g) of hake; 10 salads (4000 g) + 4 fish salads (4 × 200 g = 800 g) of tomatoes", () => {
    const sales: SaleLine[] = [
      { posProductCode: "FISH", quantity: 10 },
      { posProductCode: "SALAD", quantity: 10 },
      { posProductCode: "FISH-SALAD", quantity: 4 },
    ];
    expect(theoreticalUse(sales, recipes).use).toEqual(
      new Map([
        ["hake", 3000],
        ["tomatoes", 4800],
        ["oil", 200],
      ]),
    );
  });

  it("rounds each recipe line's gross quantity, then multiplies: 100 dishes of 100 g at 60% use 16 700 g, not 16 667 g", () => {
    const rounded: Recipe[] = [
      {
        posProductCode: "X",
        lines: [{ productId: "hake", netQuantity: 100, yieldPercent: "60" }],
      },
    ];
    expect(
      theoreticalUse([{ posProductCode: "X", quantity: 100 }], rounded).use,
    ).toEqual(new Map([["hake", 16_700]]));
  });

  it("a refund (−2 fish) takes 500 g off", () => {
    const sales: SaleLine[] = [
      { posProductCode: "FISH", quantity: 10 },
      { posProductCode: "FISH", quantity: -2 },
    ];
    expect(theoreticalUse(sales, recipes).use).toEqual(
      new Map([["hake", 2000]]),
    );
  });

  it("lists POS codes sold without a recipe, once each and sorted, instead of ignoring them", () => {
    const sales: SaleLine[] = [
      { posProductCode: "WINE-GLASS", quantity: 3 },
      { posProductCode: "FISH", quantity: 1 },
      { posProductCode: "COFFEE", quantity: 5 },
      { posProductCode: "WINE-GLASS", quantity: 1 },
    ];
    expect(theoreticalUse(sales, recipes)).toEqual({
      use: new Map([["hake", 250]]),
      salesWithoutRecipe: ["COFFEE", "WINE-GLASS"],
    });
  });

  it("rejects a POS code with two recipes", () => {
    expect(() =>
      theoreticalUse(
        [{ posProductCode: "FISH", quantity: 1 }],
        [...recipes, recipes[0]!],
      ),
    ).toThrow("POS code FISH has 2 recipes; it must have exactly one");
  });

  it("rejects a number of dishes that isn't a whole number", () => {
    expect(() =>
      theoreticalUse([{ posProductCode: "FISH", quantity: 1.5 }], recipes),
    ).toThrow(RangeError);
  });

  it("throws instead of losing precision when the total is too large to be exact", () => {
    expect(() =>
      theoreticalUse(
        [{ posProductCode: "FISH", quantity: Number.MAX_SAFE_INTEGER }],
        recipes,
      ),
    ).toThrow(RangeError);
  });
});

describe("yield and theoretical use properties", () => {
  // A yield as text, from 0.01% to 1000%: hundredths of a percent, formatted with 2 decimals.
  const yieldHundredths = fc.bigInt({ min: 1n, max: 100_000n });

  it("the gross quantity is the whole number of base units nearest to net ÷ yield", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        yieldHundredths,
        (net, y) => {
          const gross = grossQuantity(net, formatFixed(y, 2));
          // gross ≈ net × 10 000 ÷ y, so gross × y is within y ÷ 2 of net × 10 000.
          const distance = BigInt(gross) * y - BigInt(net) * 10_000n;
          const absolute = distance < 0n ? -distance : distance;
          expect(2n * absolute <= y).toBe(true);
        },
      ),
    );
  });

  it("at 100% yield, the gross quantity is the net quantity", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (net) => {
        expect(grossQuantity(net, "100")).toBe(net);
      }),
    );
  });

  it("dishes sold over two sale lines give the same theoretical use as one line with their total", () => {
    const recipeArb = fc.record({
      posProductCode: fc.constant("DISH"),
      lines: fc.array(
        fc.record({
          productId: fc.constantFrom("hake", "tomatoes", "oil"),
          netQuantity: fc.integer({ min: 0, max: 10_000 }),
          yieldPercent: yieldHundredths.map((y) => formatFixed(y, 2)),
        }),
        { maxLength: 4 },
      ),
    });
    fc.assert(
      fc.property(
        recipeArb,
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (recipe, a, b) => {
          const split = theoreticalUse(
            [
              { posProductCode: "DISH", quantity: a },
              { posProductCode: "DISH", quantity: b },
            ],
            [recipe],
          );
          const together = theoreticalUse(
            [{ posProductCode: "DISH", quantity: a + b }],
            [recipe],
          );
          // Products whose total is 0 may be listed with 0 in one and not the other.
          for (const productId of ["hake", "tomatoes", "oil"]) {
            expect(split.use.get(productId) ?? 0).toBe(
              together.use.get(productId) ?? 0,
            );
          }
        },
      ),
    );
  });
});
