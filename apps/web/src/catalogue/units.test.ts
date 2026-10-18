import { MAX_FACTOR } from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { amountToFactor, factorToAmount, packBaseUnits } from "./units";

// A conversion's size is typed in kilos, litres or units (#89): 1000 base units each, since a
// base unit is a gram, a millilitre or a thousandth of a unit. Exact, on the decimal text.

describe("amountToFactor: what's typed, in base units", () => {
  it.each([
    ["6", 6000],
    ["0.25", 250],
    ["0.001", 1],
    ["30", 30_000],
    ["2147483.647", MAX_FACTOR],
  ])("%s → %d", (amount, factor) => {
    expect(amountToFactor(amount)).toBe(factor);
  });

  it("nothing it can read exactly: undefined, for the form to call it missing or invalid", () => {
    for (const amount of ["", "abc", "1.0005", "-1", "1e3"]) {
      expect(amountToFactor(amount), amount).toBeUndefined();
    }
  });
});

describe("factorToAmount: base units, as they're typed", () => {
  it.each([
    [6000, "6"],
    [250, "0.25"],
    [1, "0.001"],
    [12_000, "12"],
  ])("%d → %s", (factor, amount) => {
    expect(factorToAmount(factor)).toBe(amount);
  });

  it("any factor, written and read back, is the same factor", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_FACTOR }), (factor) => {
        expect(amountToFactor(factorToAmount(factor))).toBe(factor);
      }),
    );
  });
});

describe("packBaseUnits: a pack in base units, for the live example", () => {
  it.each([
    ["1", 6000, 6000],
    ["2.5", 12_000, 30_000],
    ["0.5", 6000, 3000],
    ["0.0001", 1000, null],
  ])("%s × %d → %s", (quantity, factor, baseUnits) => {
    expect(packBaseUnits(quantity, factor)).toBe(baseUnits);
  });

  it("is exactly quantity × factor, and null exactly when that isn't a whole number", () => {
    const millionths = fc.bigInt({ min: 1n, max: 100_000_000_000n });
    fc.assert(
      fc.property(
        millionths,
        fc.integer({ min: 1, max: MAX_FACTOR }),
        (m, factor) => {
          const whole = m / 1_000_000n;
          const fraction = (m % 1_000_000n).toString().padStart(6, "0");
          const quantity = `${whole}.${fraction}`;
          const exact = m * BigInt(factor);
          expect(packBaseUnits(quantity, factor)).toBe(
            exact % 1_000_000n === 0n ? Number(exact / 1_000_000n) : null,
          );
        },
      ),
    );
  });

  it("a quantity it can't read gives null", () => {
    expect(packBaseUnits("", 1000)).toBeNull();
    expect(packBaseUnits("x", 1000)).toBeNull();
  });
});
