import { formatFixed, parseFixed, roundDiv } from "./fixed-point";
import {
  PURCHASE_QUANTITY_DECIMALS,
  parsePurchaseQuantity,
} from "./purchase-quantity";

// Money and UnitCost are both bigints underneath, on different scales. The brand (a property
// that exists only for the type checker) stops one being passed where the other is expected,
// so a unit cost can never be added up as if it were cents. It costs nothing at runtime.
declare const brand: unique symbol;

/** An amount of money in whole euro cents: €12.50 is 1250n. Excludes VAT. See decision 0015. */
export type Money = bigint & { readonly [brand]: "Money" };

/**
 * A price per unit in millionths of a euro (6 decimal places): €0.0185 per gram is 18500n.
 * Per base unit for movements and average costs, or per purchase unit for a document line's
 * unit price. Excludes VAT. See decision 0015.
 */
export type UnitCost = bigint & { readonly [brand]: "UnitCost" };

const MONEY_DECIMALS = 2;
const UNIT_COST_DECIMALS = 6;
/** Discounts and VAT rates are percentages with up to 2 decimals ("12.5" is 12.5%). */
const PERCENT_DECIMALS = 2;
const HUNDRED_PERCENT = 100n * 10n ** BigInt(PERCENT_DECIMALS);

export function moneyFromCents(cents: bigint): Money {
  return cents as Money;
}

export function unitCostFromMillionths(millionths: bigint): UnitCost {
  return millionths as UnitCost;
}

/** "12.50" → €12.50. Rejects fractions of a cent ("12.505") instead of rounding them. */
export function parseMoney(text: string): Money {
  return moneyFromCents(parseFixed(text, MONEY_DECIMALS, "an amount of money"));
}

/** €12.50 → "12.50": always 2 decimals, no currency sign. */
export function formatMoney(amount: Money): string {
  return formatFixed(amount, MONEY_DECIMALS);
}

/** "0.0185" → €0.018500. Rejects a seventh decimal place instead of rounding it. */
export function parseUnitCost(text: string): UnitCost {
  return unitCostFromMillionths(
    parseFixed(text, UNIT_COST_DECIMALS, "a unit cost"),
  );
}

/** €0.0185 → "0.018500": always 6 decimals. */
export function formatUnitCost(cost: UnitCost): string {
  return formatFixed(cost, UNIT_COST_DECIMALS);
}

export function addMoney(a: Money, b: Money): Money {
  return moneyFromCents(a + b);
}

export function subtractMoney(a: Money, b: Money): Money {
  return moneyFromCents(a - b);
}

/** The sum of any number of amounts; €0.00 for none. A document total is the sum of its line totals. */
export function sumMoney(amounts: readonly Money[]): Money {
  return moneyFromCents(amounts.reduce((total, amount) => total + amount, 0n));
}

export interface LineTotalInput {
  /** In the line's purchase unit, as printed: "2.5" kg, "12" bottles. Negative for returns. */
  quantity: string;
  /** Per purchase unit, before discount and excluding VAT. */
  unitPrice: UnitCost;
  /** The line's "Dto." column as a percentage: "5" is 5%. None means 0%. */
  discountPercent?: string;
}

/**
 * A document line's total: quantity × unit price − discount, worked out exactly and rounded
 * once to cents (a rounding point in decision 0015). Rounding only at the end means
 * 7 × €0.001428 is €0.01, not 7 × €0.00.
 */
export function lineTotal({
  quantity,
  unitPrice,
  discountPercent = "0",
}: LineTotalInput): Money {
  const units = parsePurchaseQuantity(quantity);
  const discount = parseFixed(discountPercent, PERCENT_DECIMALS, "a discount");
  if (discount < 0n || discount > HUNDRED_PERCENT) {
    throw new RangeError(
      `a discount must be between 0% and 100%, got ${JSON.stringify(discountPercent)}%`,
    );
  }
  // Every factor is a whole number at its own scale, so their product is exact:
  //   quantity (10^-6) × price (10^-6 €) × share kept after discount (10^-4) = 10^-16 €.
  // Cents are 10^-2 €, so divide by 10^14 to get cents, rounding once.
  const exact = units * unitPrice * (HUNDRED_PERCENT - discount);
  const scale =
    PURCHASE_QUANTITY_DECIMALS +
    UNIT_COST_DECIMALS +
    PERCENT_DECIMALS +
    2 - // the discount is a percentage: ÷ 100
    MONEY_DECIMALS;
  return moneyFromCents(roundDiv(exact, 10n ** BigInt(scale)));
}

/**
 * `percent`% of an amount, rounded once to cents, half away from zero (a rounding point in
 * decision 0015). For VAT: €63.14 at 21% is €13.2594, so €13.26. The percentage has up to 2
 * decimals and is between 0 and 100.
 */
export function percentageOf(amount: Money, percent: string): Money {
  const share = parseFixed(percent, PERCENT_DECIMALS, "a percentage");
  if (share < 0n || share > HUNDRED_PERCENT) {
    throw new RangeError(
      `a percentage must be between 0% and 100%, got ${JSON.stringify(percent)}%`,
    );
  }
  return moneyFromCents(roundDiv(amount * share, HUNDRED_PERCENT));
}
