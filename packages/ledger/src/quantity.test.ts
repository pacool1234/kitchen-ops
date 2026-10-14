import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { addQuantities } from "./quantity";

// Any valid quantity: a whole number of base units (g, ml or thousandths of a unit), positive or negative.
const quantity = fc.maxSafeInteger();

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

  // TODO(repo owner): write this property in the pairing session, then change `it.todo` to `it`.
  // Plain statement: for any quantity q, adding zero gives q back (q + 0 = q).
  // Hints:
  //   fc.assert(fc.property(quantity, (q) => { ... }));
  //   Inside, use expect(...) as in the tests above. fast-check runs it with 100 random quantities
  //   and, if one fails, shrinks it to the smallest failing example.
  it.todo("adding zero leaves a quantity unchanged");
});

// Referenced only by the TODO above; remove this line once the property uses `quantity`.
void quantity;
