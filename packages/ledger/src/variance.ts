import { roundDiv } from "./fixed-point";
import { moneyFromCents, type Money, type UnitCost } from "./money";
import { addQuantities, type Quantity } from "./quantity";
import { theoreticalUse, type Recipe, type SaleLine } from "./recipe";

/**
 * One product's figures for a period, in base units, worked out by the caller (the ledger's
 * movements have no dates). Waste is positive: what was thrown away.
 */
export interface StockFigures {
  readonly productId: string;
  readonly openingCount: Quantity;
  readonly received: Quantity;
  readonly transfersIn: Quantity;
  readonly transfersOut: Quantity;
  readonly closingCount: Quantity;
  readonly recordedWaste: Quantity;
  /** Per base unit, to value the variance. */
  readonly averageCost: UnitCost;
}

export interface VarianceLine {
  readonly productId: string;
  readonly actualUse: Quantity;
  readonly theoreticalUse: Quantity;
  readonly recordedWaste: Quantity;
  /** Positive: stock missing that nothing explains. Negative: more left than expected. */
  readonly unexplainedVariance: Quantity;
  /** Positive is a loss. */
  readonly varianceValue: Money;
}

export interface VarianceReport {
  /** One line per product in the figures, largest loss first. */
  readonly lines: readonly VarianceLine[];
  /** POS codes sold without a recipe: their ingredients' theoretical use is missing. */
  readonly salesWithoutRecipe: readonly string[];
  /** Products the recipes use that have no figures, sorted: they have no line. */
  readonly productsWithoutFigures: readonly string[];
}

/** A cent is 10 000 millionths of a euro. */
const MILLIONTHS_PER_CENT = 10_000n;

/** Opening count + received + transfers in − transfers out − closing count (spec section 4). */
export function actualUse(figures: StockFigures): Quantity {
  return [
    figures.received,
    figures.transfersIn,
    0 - figures.transfersOut,
    0 - figures.closingCount,
  ].reduce(addQuantities, figures.openingCount);
}

/**
 * Unexplained variance × average unit cost, rounded once to cents, half away from zero (a
 * rounding point in decision 0015). 900 g at €0.018/g is €16.20.
 */
export function varianceValue(
  unexplainedVariance: Quantity,
  averageCost: UnitCost,
): Money {
  return moneyFromCents(
    roundDiv(BigInt(unexplainedVariance) * averageCost, MILLIONTHS_PER_CENT),
  );
}

/**
 * Variance per product for a period (spec section 4): actual use, theoretical use from the
 * dishes sold, unexplained variance = actual − theoretical − recorded waste, and its value.
 * Sorted by variance value, largest loss first, then by product. Also lists what it couldn't
 * account for, instead of hiding it. Throws if a product has more than one set of figures.
 */
export function varianceReport(
  figures: readonly StockFigures[],
  sales: readonly SaleLine[],
  recipes: readonly Recipe[],
): VarianceReport {
  const { use, salesWithoutRecipe } = theoreticalUse(sales, recipes);

  const seen = new Set<string>();
  const lines = figures.map((f): VarianceLine => {
    if (seen.has(f.productId)) {
      const count = figures.filter((g) => g.productId === f.productId).length;
      throw new Error(
        `product ${f.productId} has ${count} sets of figures; it must have exactly one`,
      );
    }
    seen.add(f.productId);
    const actual = actualUse(f);
    const theoretical = use.get(f.productId) ?? 0;
    const unexplained = [0 - theoretical, 0 - f.recordedWaste].reduce(
      addQuantities,
      actual,
    );
    return {
      productId: f.productId,
      actualUse: actual,
      theoreticalUse: theoretical,
      recordedWaste: f.recordedWaste,
      unexplainedVariance: unexplained,
      varianceValue: varianceValue(unexplained, f.averageCost),
    };
  });

  // Largest value first; equal values by product. Product IDs are unique here (checked above),
  // so two lines are never fully equal.
  lines.sort((a, b) => {
    if (a.varianceValue !== b.varianceValue) {
      return a.varianceValue > b.varianceValue ? -1 : 1;
    }
    return a.productId < b.productId ? -1 : 1;
  });

  return {
    lines,
    salesWithoutRecipe,
    productsWithoutFigures: [...use.keys()]
      .filter((productId) => !seen.has(productId))
      .sort(),
  };
}
