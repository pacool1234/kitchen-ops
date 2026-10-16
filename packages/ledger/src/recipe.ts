import { parseFixed, roundDiv } from "./fixed-point";
import { quantityFromBigInt, type Quantity } from "./quantity";

// Recipe, SaleLine and yields are Hypothesis in the spec (section 3): these types are kept
// minimal, since discovery may reshape them.

/** Yields are percentages with up to 2 decimals ("62.5" is 62.5%), like discounts. */
const YIELD_DECIMALS = 2;
const HUNDRED_PERCENT = 100n * 10n ** BigInt(YIELD_DECIMALS);

/** One ingredient of a dish, per dish sold. */
export interface RecipeLine {
  readonly productId: string;
  /** Usable quantity on the plate, in the product's base units. */
  readonly netQuantity: Quantity;
  /**
   * Usable share of what is drawn from stock, as a percentage: "60" for fish that loses 40% to
   * bones and skin. Above 100% for food that gains weight, such as rice. None means 100%.
   */
  readonly yieldPercent?: string;
}

/** What one dish uses. Recipes are matched to sales by POS product code. */
export interface Recipe {
  readonly posProductCode: string;
  readonly lines: readonly RecipeLine[];
}

/** Dishes sold, imported from the POS. Negative for refunds. */
export interface SaleLine {
  readonly posProductCode: string;
  readonly quantity: number;
}

/**
 * Gross quantity drawn from stock for a net quantity: net ÷ yield (spec section 4, "Yields"),
 * rounded to whole base units, half away from zero (a rounding point in decision 0015). 150 g of
 * fish at 60% draws 250 g; 100 g at 60% draws 167 g.
 */
export function grossQuantity(net: Quantity, yieldPercent = "100"): Quantity {
  if (!Number.isSafeInteger(net) || net < 0) {
    throw new RangeError(
      `a net quantity must be a whole number of base units, 0 or more, got ${net}`,
    );
  }
  const share = parseFixed(yieldPercent, YIELD_DECIMALS, "a yield");
  if (share <= 0n) {
    throw new RangeError(
      `a yield must be above 0%, got ${JSON.stringify(yieldPercent)}%`,
    );
  }
  return quantityFromBigInt(
    roundDiv(BigInt(net) * HUNDRED_PERCENT, share),
    `${net} base units at ${yieldPercent}% yield`,
  );
}

export interface TheoreticalUse {
  /** Base units per product. */
  readonly use: ReadonlyMap<string, Quantity>;
  /** POS codes sold that have no recipe, sorted: their ingredients are missing from `use`. */
  readonly salesWithoutRecipe: readonly string[];
}

/**
 * What the recipes say should have been used: Σ dishes sold × gross recipe quantity, per product
 * (spec section 4, "Variance"). Each recipe line's gross quantity is rounded first, then
 * multiplied, as on the recipe card. Throws if a POS code has more than one recipe.
 */
export function theoreticalUse(
  sales: readonly SaleLine[],
  recipes: readonly Recipe[],
): TheoreticalUse {
  const totals = new Map<string, bigint>();
  const withoutRecipe = new Set<string>();
  for (const sale of sales) {
    if (!Number.isSafeInteger(sale.quantity)) {
      throw new RangeError(
        `dishes sold must be a whole number, got ${sale.quantity} of ${sale.posProductCode}`,
      );
    }
    const matches = recipes.filter(
      (r) => r.posProductCode === sale.posProductCode,
    );
    const [recipe] = matches;
    if (recipe === undefined) {
      withoutRecipe.add(sale.posProductCode);
      continue;
    }
    if (matches.length > 1) {
      throw new Error(
        `POS code ${sale.posProductCode} has ${matches.length} recipes; it must have exactly one`,
      );
    }
    for (const line of recipe.lines) {
      const gross = grossQuantity(line.netQuantity, line.yieldPercent);
      totals.set(
        line.productId,
        (totals.get(line.productId) ?? 0n) +
          BigInt(sale.quantity) * BigInt(gross),
      );
    }
  }

  const use = new Map<string, Quantity>();
  for (const [productId, total] of totals) {
    use.set(
      productId,
      quantityFromBigInt(total, `theoretical use of product ${productId}`),
    );
  }
  return { use, salesWithoutRecipe: [...withoutRecipe].sort() };
}
