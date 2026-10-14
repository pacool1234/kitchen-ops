import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { addQuantities } from "./quantity";

// Any valid quantity: a whole number of base units (g, ml or thousandths of a unit), positive or negative.
// About 1 in 5 values is an edge case, because purely random safe integers almost never hit
// 0, ±1 or the overflow limits, which is where bugs usually hide.
const quantity = fc.oneof(
  {
    arbitrary: fc.constantFrom(
      0,
      1,
      -1,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ),
    weight: 1,
  },
  { arbitrary: fc.maxSafeInteger(), weight: 4 },
);

describe("addQuantities", () => {
  it("1500 g + 250 g = 1750 g", () => {
    expect(addQuantities(1500, 250)).toBe(1750);
  });

  it("a negative quantity (stock going out) subtracts: 1750 g + -2000 g = -250 g", () => {
    expect(addQuantities(1750, -2000)).toBe(-250);
  });

  it("throws instead of losing precision when the sum is too large to be exact", () => {
    expect(() => addQuantities(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });

  it("rejects inputs that are not whole numbers of base units", () => {
    expect(() => addQuantities(1.5, 1)).toThrow(RangeError);
    expect(() => addQuantities(1, Number.NaN)).toThrow(RangeError);
  });

  it("adding zero leaves a quantity unchanged", () => {
    fc.assert(
      fc.property(quantity, (q) => {
        expect(addQuantities(q, 0)).toBe(q);
        expect(addQuantities(0, q)).toBe(q);
      }),
      // Always try 0 first, so a bug that only shows at zero fails every run, not some.
      { examples: [[0]] },
    );
  });
});
