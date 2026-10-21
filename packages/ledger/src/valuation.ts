import { moneyFromCents, type Money, type UnitCost } from "./money";
import type { Movement } from "./movement";
import type { Quantity } from "./quantity";

// Placeholder for #148: the tests come first.

export interface PlaceValue {
  readonly productId: string;
  readonly storeroomId: string;
  readonly onHand: Quantity;
  readonly averageCost: UnitCost;
  readonly value: Money;
}

export interface Valuation {
  readonly places: readonly PlaceValue[];
  readonly storerooms: ReadonlyMap<string, Money>;
  readonly total: Money;
}

export function stockValue(_onHand: Quantity, _averageCost: UnitCost): Money {
  return moneyFromCents(-1n);
}

export function valuation(_movements: readonly Movement[]): Valuation {
  return { places: [], storerooms: new Map(), total: moneyFromCents(-1n) };
}
