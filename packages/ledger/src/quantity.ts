/**
 * A stock quantity: a whole number of the product's base unit (grams, millilitres,
 * or thousandths of a unit). Negative for stock going out. See decision 0010.
 */
export type Quantity = number;

function assertQuantity(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `${name} must be a safe integer of base units, got ${value}`,
    );
  }
}

/** Adds two quantities. Throws a RangeError if an input or the result is not exact. */
export function addQuantities(a: Quantity, b: Quantity): Quantity {
  assertQuantity(a, "a");
  assertQuantity(b, "b");
  const sum = a + b;
  assertQuantity(sum, "sum");
  return sum;
}
