import { averageCost } from "./cost";
import { roundDiv } from "./fixed-point";
import {
  addMoney,
  moneyFromCents,
  sumMoney,
  type Money,
  type UnitCost,
} from "./money";
import { stockOnHand, type Movement } from "./movement";
import type { Quantity } from "./quantity";

/** A cent is 10 000 millionths of a euro. */
const MILLIONTHS_PER_CENT = 10_000n;

/**
 * What a stock is worth: on hand × average cost, rounded once to cents, half away from zero (a
 * rounding point in decision 0043, next to decision 0015's). 2350 g at €0.033400/g is €78.49.
 * Negative stock, from a flagged adjustment, is worth a negative amount.
 */
export function stockValue(onHand: Quantity, averageCost: UnitCost): Money {
  return moneyFromCents(
    roundDiv(BigInt(onHand) * averageCost, MILLIONTHS_PER_CENT),
  );
}

/** A product in a storeroom: its stock, its average cost there, and what that stock is worth. */
export interface PlaceValue {
  readonly productId: string;
  readonly storeroomId: string;
  readonly onHand: Quantity;
  readonly averageCost: UnitCost;
  readonly value: Money;
}

export interface Valuation {
  /** Every product and storeroom with movements, in the order they first moved; none twice. */
  readonly places: readonly PlaceValue[];
  /** Each storeroom's value: the sum of its places' rounded values, so it adds up on screen. */
  readonly storerooms: ReadonlyMap<string, Money>;
  /** The sum of the storerooms' values. */
  readonly total: Money;
}

/**
 * Stock and its value everywhere (spec 11.4, M8): each product's stock, average cost and value
 * in each storeroom it has moved through, each storeroom's value and the total. Movements are
 * grouped by place once, so each place's cost replays only its own movements.
 */
export function valuation(movements: readonly Movement[]): Valuation {
  const byPlace = new Map<string, Movement[]>();
  for (const m of movements) {
    const key = JSON.stringify([m.productId, m.storeroomId]);
    const here = byPlace.get(key);
    if (here) here.push(m);
    else byPlace.set(key, [m]);
  }

  const places = [...byPlace.values()].map((here): PlaceValue => {
    const { productId, storeroomId } = here[0]!;
    const onHand = stockOnHand(here, productId, storeroomId);
    const cost = averageCost(here, productId, storeroomId);
    return {
      productId,
      storeroomId,
      onHand,
      averageCost: cost,
      value: stockValue(onHand, cost),
    };
  });

  const storerooms = new Map<string, Money>();
  for (const p of places) {
    storerooms.set(
      p.storeroomId,
      addMoney(storerooms.get(p.storeroomId) ?? moneyFromCents(0n), p.value),
    );
  }
  return { places, storerooms, total: sumMoney([...storerooms.values()]) };
}
