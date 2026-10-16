import { formatFixed } from "./fixed-point";
import {
  PURCHASE_QUANTITY_DECIMALS,
  parsePurchaseQuantity,
} from "./purchase-quantity";
import { quantityFromBigInt, type Quantity } from "./quantity";

/**
 * How many base units one purchase unit of a product holds (spec section 3). Per product,
 * because the same unit name means different amounts: a box of tomatoes is 6000 g, a box of
 * eggs 30 000 thousandths (30 eggs). A product's base unit is a conversion too, with factor 1.
 */
export interface UnitConversion {
  readonly productId: string;
  /** As used on documents, matched exactly: "kg" is not "KG". */
  readonly unit: string;
  /** Base units per purchase unit: a positive whole number (decision 0010). */
  readonly factor: number;
}

/** A quantity in a purchase unit, as on a document line. */
export interface PurchaseQuantity {
  readonly productId: string;
  /** As printed, up to 6 decimals: "2.5". Negative for returns. */
  readonly quantity: string;
  readonly unit: string;
}

const PURCHASE_UNIT = 10n ** BigInt(PURCHASE_QUANTITY_DECIMALS);

/**
 * Converts a purchase quantity to whole base units: 1.5 boxes of 6000 g is 9000 g. Throws if the
 * product has no conversion (or more than one) for the unit, if the factor isn't a positive
 * whole number, or if the result isn't a whole number of base units: 0.0001 kg is 0.1 g, and is
 * rejected instead of rounded.
 */
export function toBaseUnits(
  { productId, quantity, unit }: PurchaseQuantity,
  conversions: readonly UnitConversion[],
): Quantity {
  const matches = conversions.filter(
    (c) => c.productId === productId && c.unit === unit,
  );
  const [conversion] = matches;
  if (conversion === undefined) {
    throw new Error(`"${unit}" has no conversion for product ${productId}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `"${unit}" has ${matches.length} conversions for product ${productId}; it must have exactly one`,
    );
  }
  const { factor } = conversion;
  if (!Number.isSafeInteger(factor) || factor <= 0) {
    throw new RangeError(
      `the factor for "${unit}" of product ${productId} must be a positive whole number of base units, got ${factor}`,
    );
  }

  // Exact: millionths of the purchase unit × base units per purchase unit.
  const exact = parsePurchaseQuantity(quantity) * BigInt(factor);
  if (exact % PURCHASE_UNIT !== 0n) {
    // "0.100000" → "0.1" for the message.
    const baseUnits = formatFixed(exact, PURCHASE_QUANTITY_DECIMALS).replace(
      /\.?0+$/,
      "",
    );
    throw new RangeError(
      `${quantity} ${unit} of product ${productId} is ${baseUnits} base units, not a whole number`,
    );
  }
  return quantityFromBigInt(
    exact / PURCHASE_UNIT,
    `${quantity} ${unit} of product ${productId}`,
  );
}
