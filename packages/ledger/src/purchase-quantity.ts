import { parseFixed } from "./fixed-point";

/** Decimal places a document line's quantity may have, in its purchase unit ("2.5" kg). */
export const PURCHASE_QUANTITY_DECIMALS = 6;

/**
 * A document line's quantity as printed ("2.5" kg, "12" bottles), as a whole number of
 * millionths of the purchase unit: "2.5" is 2_500_000n. Negative for returns. Rejects a
 * seventh decimal place instead of rounding it.
 *
 * Shared by line totals and unit conversions; not exported from the package.
 */
export function parsePurchaseQuantity(text: string): bigint {
  return parseFixed(text, PURCHASE_QUANTITY_DECIMALS, "a line quantity");
}
