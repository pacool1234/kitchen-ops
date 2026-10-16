import type { UnitCost } from "./money";
import { addQuantities, type Quantity } from "./quantity";

/**
 * What caused a movement, from the document that posted it (#32). A reversal keeps the kind of
 * the movement it reverses, so "waste this month" nets out without special cases.
 */
export type MovementKind =
  "receipt" | "waste" | "count" | "transfer-out" | "transfer-in";

/**
 * One append-only change to stock (spec section 3). Movements are never updated or deleted: a
 * mistake is corrected by a reversing movement plus a new one (invariant 3).
 *
 * Movements have no date: their order is the order of the list they are in. Dates belong to
 * documents, and whoever replays movements decides their order.
 */
export interface Movement {
  /** Passed in, never generated here. */
  readonly id: string;
  /** Product and Storeroom are still Hypothesis in the spec: referred to by ID only. */
  readonly productId: string;
  readonly storeroomId: string;
  /** Base units, signed: positive into the storeroom, negative out of it. */
  readonly quantity: Quantity;
  /** Per base unit. */
  readonly unitCost: UnitCost;
  /** The posted document line that caused it (invariant 2). */
  readonly documentLineId: string;
  readonly kind: MovementKind;
  /** The id of the movement this one reverses, if it is a reversal. */
  readonly reverses?: string;
  /**
   * A flagged adjustment: the only movement allowed to take stock below zero (invariant 6).
   * Reports list them with `flaggedAdjustments`. Any kind can be flagged.
   */
  readonly adjustment?: true;
}

/** Stock per product, then per storeroom: `balances.get(productId)?.get(storeroomId)`. */
export type Balances = ReadonlyMap<string, ReadonlyMap<string, Quantity>>;

/** Stock on hand of a product in a storeroom: the sum of its movements (invariant 1). */
export function stockOnHand(
  movements: readonly Movement[],
  productId: string,
  storeroomId: string,
): Quantity {
  return movements
    .filter((m) => m.productId === productId && m.storeroomId === storeroomId)
    .reduce((total, m) => addQuantities(total, m.quantity), 0);
}

/** Every product's stock in every storeroom that has movements. */
export function balancesOf(movements: readonly Movement[]): Balances {
  const balances = new Map<string, Map<string, Quantity>>();
  for (const m of movements) {
    const storerooms = balances.get(m.productId) ?? new Map<string, Quantity>();
    balances.set(m.productId, storerooms);
    storerooms.set(
      m.storeroomId,
      addQuantities(storerooms.get(m.storeroomId) ?? 0, m.quantity),
    );
  }
  return balances;
}

/**
 * Cached balances with one more movement added: how a stored balance is kept up to date
 * without summing everything again. Returns new balances; the ones passed in are unchanged.
 */
export function applyMovement(
  balances: Balances,
  movement: Movement,
): Balances {
  const storerooms = new Map(balances.get(movement.productId));
  storerooms.set(
    movement.storeroomId,
    addQuantities(storerooms.get(movement.storeroomId) ?? 0, movement.quantity),
  );
  return new Map(balances).set(movement.productId, storerooms);
}

export interface BalanceMismatch {
  readonly productId: string;
  readonly storeroomId: string;
  readonly cached: Quantity;
  readonly actual: Quantity;
}

/**
 * Checks cached balances against the movements (invariant 1: a cached balance must be
 * rebuildable from them). Lists every product and storeroom where they disagree, sorted by
 * product, then storeroom. A location missing from either side counts as 0.
 */
export function findBalanceMismatches(
  cached: Balances,
  movements: readonly Movement[],
): BalanceMismatch[] {
  const actual = balancesOf(movements);
  const locations = new Map<string, readonly [string, string]>();
  for (const balances of [cached, actual]) {
    for (const [productId, storerooms] of balances) {
      for (const storeroomId of storerooms.keys()) {
        locations.set(JSON.stringify([productId, storeroomId]), [
          productId,
          storeroomId,
        ]);
      }
    }
  }

  const mismatches: BalanceMismatch[] = [];
  for (const [productId, storeroomId] of locations.values()) {
    const cachedQuantity = cached.get(productId)?.get(storeroomId) ?? 0;
    const actualQuantity = actual.get(productId)?.get(storeroomId) ?? 0;
    if (cachedQuantity !== actualQuantity) {
      mismatches.push({
        productId,
        storeroomId,
        cached: cachedQuantity,
        actual: actualQuantity,
      });
    }
  }
  return mismatches.sort(
    (a, b) =>
      compare(a.productId, b.productId) ||
      compare(a.storeroomId, b.storeroomId),
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The movement that cancels `original`: the same product, storeroom, kind and unit cost, the
 * opposite quantity. It belongs to the reversing document, so its id and document line are
 * passed in. `movements` is everything posted so far, used to reject reversing a reversal,
 * reversing the same movement twice, or reusing an id.
 */
export function reverseMovement(
  original: Movement,
  movements: readonly Movement[],
  { id, documentLineId }: { id: string; documentLineId: string },
): Movement {
  if (!movements.some((m) => m.id === original.id)) {
    throw new Error(`movement ${original.id} is not in the movements given`);
  }
  if (original.reverses !== undefined) {
    throw new Error(
      `movement ${original.id} is itself a reversal (of ${original.reverses}); post a new movement instead`,
    );
  }
  const earlier = movements.find((m) => m.reverses === original.id);
  if (earlier) {
    throw new Error(
      `movement ${original.id} is already reversed by ${earlier.id}`,
    );
  }
  if (movements.some((m) => m.id === id)) {
    throw new Error(`id ${id} is already used`);
  }
  return {
    id,
    productId: original.productId,
    storeroomId: original.storeroomId,
    // 0 − x, not −x: reversing a movement of 0 must give 0, not −0.
    quantity: 0 - original.quantity,
    unitCost: original.unitCost,
    documentLineId,
    kind: original.kind,
    reverses: original.id,
  };
}

/**
 * Adds movements to the existing ones: the checked way to append (invariant 6). Applies the new
 * movements in order and rejects them all if one that lowers stock leaves it below zero without
 * being a flagged adjustment. Stock coming in is always accepted. Returns a new list; the one
 * passed in is unchanged.
 */
export function appendMovements(
  existing: readonly Movement[],
  added: readonly Movement[],
): readonly Movement[] {
  let balances = balancesOf(existing);
  for (const m of added) {
    const before = balances.get(m.productId)?.get(m.storeroomId) ?? 0;
    const stock = addQuantities(before, m.quantity);
    if (m.quantity < 0 && stock < 0 && m.adjustment !== true) {
      throw new Error(
        `movement ${m.id} would take stock of product ${m.productId} in storeroom ${m.storeroomId} to ${stock}; only a flagged adjustment can take stock below zero`,
      );
    }
    balances = applyMovement(balances, m);
  }
  return [...existing, ...added];
}

/** Every flagged adjustment, in list order, for reports (invariant 6). */
export function flaggedAdjustments(movements: readonly Movement[]): Movement[] {
  return movements.filter((m) => m.adjustment === true);
}
