import { roundDiv } from "./fixed-point";
import { unitCostFromMillionths, type Money, type UnitCost } from "./money";
import { latestVersionOf, type Movement } from "./movement";
import { addQuantities, type Quantity } from "./quantity";

/** A cent is 10 000 millionths of a euro. */
const MILLIONTHS_PER_CENT = 10_000n;

/**
 * What one base unit of a delivery cost: line total after discount ÷ quantity in base units
 * (spec section 4), rounded once to 6 decimals, half away from zero (a rounding point in
 * decision 0015). €4.80 for 2500 g is €0.001920 per gram. A return (both negative) gives a
 * positive cost. Rejects a quantity of 0, and signs that would make the cost negative.
 */
export function receivedUnitCost(
  lineTotal: Money,
  quantity: Quantity,
): UnitCost {
  if (!Number.isSafeInteger(quantity) || quantity === 0) {
    throw new RangeError(
      `a received quantity must be a non-zero whole number of base units, got ${quantity}`,
    );
  }
  if ((lineTotal < 0n && quantity > 0) || (lineTotal > 0n && quantity < 0)) {
    throw new RangeError(
      `a line total of ${lineTotal} cents for ${quantity} base units would be a negative cost`,
    );
  }
  // roundDiv needs a positive divisor: for a return, negate both.
  const sign = quantity < 0 ? -1n : 1n;
  return unitCostFromMillionths(
    roundDiv(sign * lineTotal * MILLIONTHS_PER_CENT, sign * BigInt(quantity)),
  );
}

/**
 * The IDs of reversed movements. A reversed movement and its reversal are left out of costs, so
 * a correction gives exactly the cost as if the mistake had never been posted.
 */
function reversedIds(movements: readonly Movement[]): ReadonlySet<string> {
  return new Set(
    movements.flatMap((m) => (m.reverses === undefined ? [] : [m.reverses])),
  );
}

/** Whether a movement counts for costs: it isn't a reversal, and it hasn't been reversed. */
function counts(movement: Movement, reversed: ReadonlySet<string>): boolean {
  return movement.reverses === undefined && !reversed.has(movement.id);
}

/**
 * The movements that count for costs, in the order costs replay them: list order, except that a
 * correction (decision 0032) takes the place of the receipt it corrects, or of the first receipt
 * in its chain. Reversed movements and reversals are left out. A corrected price then gives
 * exactly the costs it would have given had it been the receipt's price in the first place.
 */
function inCostOrder(movements: readonly Movement[]): Movement[] {
  const reversed = reversedIds(movements);
  const ids = new Set(movements.map((m) => m.id));
  const latest = latestVersionOf(movements);
  return movements.flatMap((m) => {
    // A correction is placed with the receipt it corrects, unless that one isn't in the list.
    const placedEarlier = m.corrects !== undefined && ids.has(m.corrects);
    if (m.reverses !== undefined || placedEarlier) return [];
    const current = latest(m);
    return counts(current, reversed) ? [current] : [];
  });
}

/**
 * Weighted-average cost per base unit of a product in a storeroom, by replaying its movements
 * in list order (spec section 4, decision 0005):
 *
 * - Stock coming in at its own cost (a receipt or transfer in with a positive quantity):
 *   new average = (stock × average + quantity × its cost) ÷ (stock + quantity), rounded to 6
 *   decimals at each recalculation (a rounding point in decision 0015). If stock is zero or
 *   negative before it, the new average is its cost.
 * - Everything else (waste, counts, transfers out, returns) is valued at the average and leaves
 *   it unchanged, whatever unit cost it carries. It only changes the stock.
 * - A reversed movement and its reversal are left out entirely.
 * - A correction counts in the place of the receipt it corrects (decision 0032).
 *
 * €0 if nothing has come in: stock with no recorded cost.
 */
export function averageCost(
  movements: readonly Movement[],
  productId: string,
  storeroomId: string,
): UnitCost {
  const here = movements.filter(
    (m) => m.productId === productId && m.storeroomId === storeroomId,
  );
  let stock: Quantity = 0;
  let average = 0n;
  for (const m of inCostOrder(here)) {
    if (m.quantity > 0 && (m.kind === "receipt" || m.kind === "transfer-in")) {
      average =
        stock <= 0
          ? m.unitCost
          : roundDiv(
              BigInt(stock) * average + BigInt(m.quantity) * m.unitCost,
              BigInt(stock + m.quantity),
            );
    }
    stock = addQuantities(stock, m.quantity);
  }
  return unitCostFromMillionths(average);
}

/**
 * The unit cost of a product's latest purchase, in any storeroom: the last receipt with a
 * positive quantity that hasn't been reversed, in list order, with corrections in the place of
 * the receipts they correct. For recipe costing (spec section
 * 4, "Recipe costing"), not stock valuation. Undefined if the product was never bought, so an
 * uncosted recipe shows up instead of looking free.
 */
export function latestPurchasePrice(
  movements: readonly Movement[],
  productId: string,
): UnitCost | undefined {
  return inCostOrder(
    movements.filter((m) => m.productId === productId),
  ).findLast((m) => m.kind === "receipt" && m.quantity > 0)?.unitCost;
}
