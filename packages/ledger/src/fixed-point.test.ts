import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatFixed, parseFixed, roundDiv } from "./fixed-point";

// Any amount, small or far beyond real prices: bigint has no size limit, so neither do the tests.
const amount = fc.oneof(
  { arbitrary: fc.constantFrom(0n, 1n, -1n, 5n, -5n), weight: 1 },
  { arbitrary: fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }), weight: 4 },
);
const positiveDivisor = fc.oneof(
  { arbitrary: fc.constantFrom(1n, 2n, 10n, 100n, 10n ** 14n), weight: 1 },
  { arbitrary: fc.bigInt({ min: 1n, max: 10n ** 20n }), weight: 4 },
);

describe("parseFixed", () => {
  it("reads a decimal string as a whole number of the smallest unit: 12.50 at 2 places = 1250", () => {
    expect(parseFixed("12.50", 2, "price")).toBe(1250n);
    expect(parseFixed("12.5", 2, "price")).toBe(1250n);
    expect(parseFixed("7", 2, "price")).toBe(700n);
    expect(parseFixed("-0.05", 2, "price")).toBe(-5n);
    expect(parseFixed("0.018500", 6, "cost")).toBe(18500n);
  });

  it("rejects more decimal places than the scale instead of rounding: 12.505 at 2 places", () => {
    expect(() => parseFixed("12.505", 2, "price")).toThrow(RangeError);
  });

  it.each([
    "",
    " 12",
    "12 ",
    "+1",
    ".5",
    "5.",
    "1e3",
    "1,50",
    "--1",
    "NaN",
    "0x10",
  ])("rejects %j", (text) => {
    expect(() => parseFixed(text, 2, "price")).toThrow(RangeError);
  });

  it("names the value in the error message", () => {
    expect(() => parseFixed("abc", 2, "unit price")).toThrow(/unit price/);
  });
});

describe("formatFixed", () => {
  it("always writes every decimal place: 1250 at 2 places = 12.50", () => {
    expect(formatFixed(1250n, 2)).toBe("12.50");
    expect(formatFixed(5n, 2)).toBe("0.05");
    expect(formatFixed(-5n, 2)).toBe("-0.05");
    expect(formatFixed(0n, 2)).toBe("0.00");
    expect(formatFixed(18500n, 6)).toBe("0.018500");
    expect(formatFixed(42n, 0)).toBe("42");
  });

  it("formatting any amount and parsing the text back gives the same amount", () => {
    fc.assert(
      fc.property(amount, fc.integer({ min: 0, max: 8 }), (value, scale) => {
        expect(parseFixed(formatFixed(value, scale), scale, "value")).toBe(
          value,
        );
      }),
    );
  });
});

describe("roundDiv: divide, rounding half away from zero", () => {
  // Read each case as tenths: roundDiv(25n, 10n) is 2.5 rounded to a whole number.
  it.each([
    [0n, 0n],
    [4n, 0n], // 0.4
    [5n, 1n], // 0.5: a tie goes away from zero
    [6n, 1n], // 0.6
    [14n, 1n], // 1.4
    [15n, 2n], // 1.5
    [25n, 3n], // 2.5: away from zero, not to the even 2 (that would be banker's rounding)
    [35n, 4n], // 3.5
    [-4n, 0n], // -0.4
    [-5n, -1n], // -0.5: away from zero, downwards
    [-15n, -2n], // -1.5
    [-25n, -3n], // -2.5
    [-26n, -3n], // -2.6
    [30n, 3n], // 3.0: exact divisions are untouched
  ])("%i tenths rounds to %i", (tenths, expected) => {
    expect(roundDiv(tenths, 10n)).toBe(expected);
  });

  it("in cents: 0.005 → 0.01, 0.015 → 0.02, -0.005 → -0.01, -0.025 → -0.03 (amounts in thousandths of a euro)", () => {
    expect(roundDiv(5n, 10n)).toBe(1n);
    expect(roundDiv(15n, 10n)).toBe(2n);
    expect(roundDiv(-5n, 10n)).toBe(-1n);
    expect(roundDiv(-25n, 10n)).toBe(-3n);
    expect(roundDiv(4n, 10n)).toBe(0n); // 0.004 → 0.00
    expect(roundDiv(-6n, 10n)).toBe(-1n); // -0.006 → -0.01
  });

  it("rejects a zero or negative divisor", () => {
    expect(() => roundDiv(1n, 0n)).toThrow(RangeError);
    expect(() => roundDiv(1n, -10n)).toThrow(RangeError);
  });

  it("a rounded result is never more than half a unit away from the exact value", () => {
    fc.assert(
      fc.property(amount, positiveDivisor, (numerator, divisor) => {
        // |result − numerator ÷ divisor| ≤ ½, multiplied through by 2 × divisor to stay in integers.
        const error = roundDiv(numerator, divisor) * divisor - numerator;
        expect(2n * (error < 0n ? -error : error) <= divisor).toBe(true);
      }),
    );
  });

  it("rounding a negative value gives exactly the negative of rounding the positive one", () => {
    fc.assert(
      fc.property(amount, positiveDivisor, (numerator, divisor) => {
        expect(roundDiv(-numerator, divisor)).toBe(
          -roundDiv(numerator, divisor),
        );
      }),
    );
  });
});
