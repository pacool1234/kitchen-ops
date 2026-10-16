import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatMoney, parseUnitCost, unitCostFromMillionths } from "./money";
import type { Recipe, SaleLine } from "./recipe";
import {
  actualUse,
  varianceReport,
  varianceValue,
  type StockFigures,
} from "./variance";

// Hake for the period, in grams: 5000 at the opening count, 10 000 received, 1000 in from
// another storeroom, 500 out to one, 4000 at the closing count, 600 recorded as waste, at an
// average of €18/kg.
const hake: StockFigures = {
  productId: "hake",
  openingCount: 5000,
  received: 10_000,
  transfersIn: 1000,
  transfersOut: 500,
  closingCount: 4000,
  recordedWaste: 600,
  averageCost: parseUnitCost("0.018"),
};

// Tomatoes: 2000 + 4000 − 2200 = 3800 g used, no waste, at €2.50/kg.
const tomatoes: StockFigures = {
  productId: "tomatoes",
  openingCount: 2000,
  received: 4000,
  transfersIn: 0,
  transfersOut: 0,
  closingCount: 2200,
  recordedWaste: 0,
  averageCost: parseUnitCost("0.0025"),
};

// Oil: 1000 + 0 − 800 = 200 g used, exactly what 10 salads need.
const oil: StockFigures = {
  ...tomatoes,
  productId: "oil",
  openingCount: 1000,
  received: 0,
  closingCount: 800,
  averageCost: parseUnitCost("0.004"),
};

// Fish: 150 g net at 60% = 250 g of hake. Salad: 360 g of tomatoes at 90% = 400 g, and 20 g of oil.
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
];
const sales: readonly SaleLine[] = [
  { posProductCode: "FISH", quantity: 40 },
  { posProductCode: "SALAD", quantity: 10 },
];

describe("actualUse: opening + received + transfers in − transfers out − closing", () => {
  it("hake: 5000 + 10 000 + 1000 − 500 − 4000 = 11 500 g", () => {
    expect(actualUse(hake)).toBe(11_500);
  });

  it("throws instead of losing precision when a figure is too large to be exact", () => {
    expect(() =>
      actualUse({ ...hake, received: Number.MAX_SAFE_INTEGER }),
    ).toThrow(RangeError);
  });
});

describe("varianceValue: unexplained variance × average cost, rounded once to cents", () => {
  it("900 g missing at €0.018/g: €16.20", () => {
    expect(formatMoney(varianceValue(900, parseUnitCost("0.018")))).toBe(
      "16.20",
    );
  });

  it("7 g at €0.000714: €0.004998, rounded to €0.00; at €0.000715: €0.005005, rounded to €0.01", () => {
    expect(formatMoney(varianceValue(7, parseUnitCost("0.000714")))).toBe(
      "0.00",
    );
    expect(formatMoney(varianceValue(7, parseUnitCost("0.000715")))).toBe(
      "0.01",
    );
  });

  it("1 g at €0.005: exactly half a cent, rounded away from zero to €0.01; −1 g to −€0.01", () => {
    expect(formatMoney(varianceValue(1, parseUnitCost("0.005")))).toBe("0.01");
    expect(formatMoney(varianceValue(-1, parseUnitCost("0.005")))).toBe(
      "-0.01",
    );
  });

  it("200 g more than expected at €0.0025/g: −€0.50, a gain", () => {
    expect(formatMoney(varianceValue(-200, parseUnitCost("0.0025")))).toBe(
      "-0.50",
    );
  });
});

describe("varianceReport: per product, sorted by variance value, largest loss first", () => {
  it("hake 900 g missing (€16.20), oil exactly as expected (€0.00), tomatoes 200 g more than expected (−€0.50)", () => {
    // Hake: actual 11 500 − theoretical 40 × 250 = 10 000 − waste 600 = 900 g.
    // Tomatoes: actual 3800 − theoretical 10 × 400 = 4000 − waste 0 = −200 g.
    // Oil: actual 200 − theoretical 10 × 20 = 200 − waste 0 = 0 g.
    const report = varianceReport([tomatoes, oil, hake], sales, recipes);
    expect(
      report.lines.map((l) => ({
        ...l,
        varianceValue: formatMoney(l.varianceValue),
      })),
    ).toEqual([
      {
        productId: "hake",
        actualUse: 11_500,
        theoreticalUse: 10_000,
        recordedWaste: 600,
        unexplainedVariance: 900,
        varianceValue: "16.20",
      },
      {
        productId: "oil",
        actualUse: 200,
        theoreticalUse: 200,
        recordedWaste: 0,
        unexplainedVariance: 0,
        varianceValue: "0.00",
      },
      {
        productId: "tomatoes",
        actualUse: 3800,
        theoreticalUse: 4000,
        recordedWaste: 0,
        unexplainedVariance: -200,
        varianceValue: "-0.50",
      },
    ]);
    expect(report.salesWithoutRecipe).toEqual([]);
    expect(report.productsWithoutFigures).toEqual([]);
  });

  it("a product nobody sold: all its actual use is unexplained", () => {
    const report = varianceReport([hake], [], recipes);
    expect(report.lines).toMatchObject([
      { productId: "hake", theoreticalUse: 0, unexplainedVariance: 10_900 },
    ]);
  });

  it("lists its gaps: POS codes sold without a recipe, and products recipes use that have no figures", () => {
    const report = varianceReport(
      [hake],
      [...sales, { posProductCode: "COFFEE", quantity: 12 }],
      recipes,
    );
    expect(report.lines.map((l) => l.productId)).toEqual(["hake"]);
    expect(report.salesWithoutRecipe).toEqual(["COFFEE"]);
    expect(report.productsWithoutFigures).toEqual(["oil", "tomatoes"]);
  });

  it("equal values are sorted by product", () => {
    const a = { ...oil, productId: "a" };
    const b = { ...oil, productId: "b" };
    expect(
      varianceReport([b, a], [], []).lines.map((l) => l.productId),
    ).toEqual(["a", "b"]);
  });

  it("rejects two sets of figures for one product", () => {
    expect(() => varianceReport([hake, hake], sales, recipes)).toThrow(
      "product hake has 2 sets of figures; it must have exactly one",
    );
  });
});

const PRODUCTS = ["p0", "p1", "p2", "p3", "p4", "p5"];
const quantity = fc.integer({ min: 0, max: 1_000_000 });
const cost = fc.bigInt({ min: 0n, max: 10n ** 7n }).map(unitCostFromMillionths);

describe("variance properties", () => {
  it("when actual use equals theoretical use plus waste, unexplained variance is zero and so is its value", () => {
    // One recipe per product, 1 g with no yield, so theoretical use is the number sold. The
    // figures are then built so that actual use is exactly that plus waste.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            sold: fc.integer({ min: -1000, max: 100_000 }),
            recordedWaste: quantity,
            opening: quantity,
            transfersIn: quantity,
            transfersOut: quantity,
            averageCost: cost,
          }),
          { minLength: 1, maxLength: PRODUCTS.length },
        ),
        (products) => {
          const figures: StockFigures[] = products.map((p, i) => ({
            productId: PRODUCTS[i]!,
            openingCount: p.opening,
            // Chosen so that actual use = sold + waste.
            received: p.sold + p.recordedWaste + p.transfersOut - p.transfersIn,
            transfersIn: p.transfersIn,
            transfersOut: p.transfersOut,
            closingCount: p.opening,
            recordedWaste: p.recordedWaste,
            averageCost: p.averageCost,
          }));
          const recipes: Recipe[] = products.map((_, i) => ({
            posProductCode: `dish-${i}`,
            lines: [{ productId: PRODUCTS[i]!, netQuantity: 1 }],
          }));
          const sales: SaleLine[] = products.map((p, i) => ({
            posProductCode: `dish-${i}`,
            quantity: p.sold,
          }));
          const report = varianceReport(figures, sales, recipes);
          expect(report.lines).toHaveLength(products.length);
          for (const line of report.lines) {
            expect(line.actualUse).toBe(
              line.theoreticalUse + line.recordedWaste,
            );
            expect(line.unexplainedVariance).toBe(0);
            expect(line.varianceValue).toBe(0n);
          }
        },
      ),
    );
  });

  it("variance value never has the opposite sign to unexplained variance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        cost,
        (unexplained, averageCost) => {
          const value = varianceValue(unexplained, averageCost);
          if (unexplained > 0) expect(value >= 0n).toBe(true);
          if (unexplained < 0) expect(value <= 0n).toBe(true);
          if (unexplained === 0) expect(value).toBe(0n);
        },
      ),
    );
  });

  it("the report lists every product in the figures exactly once, sorted by variance value with the largest loss first", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            productId: fc.constantFrom(...PRODUCTS),
            openingCount: quantity,
            received: quantity,
            transfersIn: quantity,
            transfersOut: quantity,
            closingCount: quantity,
            recordedWaste: quantity,
            averageCost: cost,
          }),
          { selector: (f) => f.productId, maxLength: PRODUCTS.length },
        ),
        fc.array(
          fc.record({
            posProductCode: fc.constantFrom("dish-a", "dish-b"),
            quantity: fc.integer({ min: -10, max: 1000 }),
          }),
          { maxLength: 5 },
        ),
        fc.array(fc.constantFrom(...PRODUCTS), { minLength: 1, maxLength: 3 }),
        (figures, sales, dishAProducts) => {
          const recipes: Recipe[] = [
            {
              posProductCode: "dish-a",
              lines: dishAProducts.map((productId) => ({
                productId,
                netQuantity: 100,
                yieldPercent: "80",
              })),
            },
          ];
          const { lines } = varianceReport(figures, sales, recipes);
          expect(lines.map((l) => l.productId).sort()).toEqual(
            figures.map((f) => f.productId).sort(),
          );
          for (let i = 1; i < lines.length; i++) {
            const before = lines[i - 1]!;
            const after = lines[i]!;
            expect(before.varianceValue >= after.varianceValue).toBe(true);
            if (before.varianceValue === after.varianceValue) {
              expect(before.productId < after.productId).toBe(true);
            }
          }
        },
      ),
    );
  });
});
