import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { toBaseUnits, type UnitConversion } from "./conversion";
import { formatFixed } from "./fixed-point";

// Base units: grams for tomatoes, thousandths of an egg for eggs, millilitres for wine.
const conversions: readonly UnitConversion[] = [
  { productId: "tomatoes", unit: "box", factor: 6000 },
  { productId: "tomatoes", unit: "kg", factor: 1000 },
  { productId: "tomatoes", unit: "g", factor: 1 },
  { productId: "eggs", unit: "box", factor: 30_000 }, // a tray of 30 eggs
  { productId: "eggs", unit: "unit", factor: 1000 },
  { productId: "eggs", unit: "dozen", factor: 12_000 },
  { productId: "wine", unit: "bottle", factor: 750 },
];

const convert = (productId: string, quantity: string, unit: string) =>
  toBaseUnits({ productId, quantity, unit }, conversions);

describe("toBaseUnits: examples computed by hand", () => {
  it("1.5 boxes of tomatoes × 6000 g = 9000 g", () => {
    expect(convert("tomatoes", "1.5", "box")).toBe(9000);
  });

  it("3 bottles of wine × 750 ml = 2250 ml", () => {
    expect(convert("wine", "3", "bottle")).toBe(2250);
  });

  it("12 eggs × 1000 thousandths = 12 000 thousandths, the same as 1 dozen", () => {
    expect(convert("eggs", "12", "unit")).toBe(12_000);
    expect(convert("eggs", "1", "dozen")).toBe(12_000);
  });

  it("2.5 kg of tomatoes = 2500 g", () => {
    expect(convert("tomatoes", "2.5", "kg")).toBe(2500);
  });

  it("a box of tomatoes is not a box of eggs: 6000 g against 30 000 thousandths (30 eggs)", () => {
    expect(convert("tomatoes", "1", "box")).toBe(6000);
    expect(convert("eggs", "1", "box")).toBe(30_000);
  });

  it("a returned line, −2 kg of tomatoes = −2000 g", () => {
    expect(convert("tomatoes", "-2", "kg")).toBe(-2000);
  });
});

describe("toBaseUnits: rejected with clear errors", () => {
  it("a unit with no conversion for the product", () => {
    expect(() => convert("tomatoes", "1", "crate")).toThrow(
      '"crate" has no conversion for product tomatoes',
    );
  });

  it("a unit that only another product has", () => {
    expect(() => convert("tomatoes", "1", "bottle")).toThrow(
      '"bottle" has no conversion for product tomatoes',
    );
  });

  it("units are matched exactly: KG is not kg", () => {
    expect(() => convert("tomatoes", "1", "KG")).toThrow(/no conversion/);
  });

  it("two conversions for the same product and unit, instead of guessing", () => {
    const twice = [
      ...conversions,
      { productId: "wine", unit: "bottle", factor: 700 },
    ];
    expect(() =>
      toBaseUnits({ productId: "wine", quantity: "1", unit: "bottle" }, twice),
    ).toThrow('"bottle" has 2 conversions for product wine');
  });

  it.each([0, -1000, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "a factor of %d, which isn't a positive whole number of base units",
    (factor) => {
      expect(() =>
        toBaseUnits({ productId: "p", quantity: "1", unit: "u" }, [
          { productId: "p", unit: "u", factor },
        ]),
      ).toThrow(RangeError);
    },
  );

  it("a result that isn't whole: 0.0001 kg = 0.1 g", () => {
    expect(() => convert("tomatoes", "0.0001", "kg")).toThrow(
      "0.0001 kg of product tomatoes is 0.1 base units, not a whole number",
    );
  });

  it("a quantity with more than 6 decimals, or that isn't a number", () => {
    expect(() => convert("tomatoes", "1.0000001", "g")).toThrow(RangeError);
    expect(() => convert("tomatoes", "1,5", "kg")).toThrow(RangeError);
  });

  it("a result too large to be an exact quantity", () => {
    expect(() => convert("tomatoes", "9007199254740992", "g")).toThrow(
      RangeError,
    );
  });
});

describe("toBaseUnits: properties", () => {
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  const MILLION = 1_000_000n;
  const factor = fc.oneof(
    { arbitrary: fc.constantFrom(1, 750, 1000, 6000, 12_000), weight: 1 },
    { arbitrary: fc.integer({ min: 1, max: 1_000_000 }), weight: 4 },
  );
  const millionths = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
  const single = (f: number): readonly UnitConversion[] => [
    { productId: "p", unit: "u", factor: f },
  ];
  // The quantity is written as text, from a count of millionths of the purchase unit.
  const convertMillionths = (m: bigint, f: number) =>
    toBaseUnits(
      { productId: "p", quantity: formatFixed(m, 6), unit: "u" },
      single(f),
    );

  it("converting two amounts separately and adding the results gives the same as converting their sum", () => {
    fc.assert(
      fc.property(
        factor,
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        (f, n1, n2) => {
          // Only quantities that convert to whole base units: multiples of the smallest such step.
          const step = MILLION / gcd(BigInt(f), MILLION);
          const a = n1 * step;
          const b = n2 * step;
          expect(convertMillionths(a, f) + convertMillionths(b, f)).toBe(
            convertMillionths(a + b, f),
          );
        },
      ),
    );
  });

  it("converting a whole number of the base unit itself (factor 1) gives that same number back", () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), (n) => {
        expect(
          toBaseUnits(
            { productId: "p", quantity: String(n), unit: "u" },
            single(1),
          ),
        ).toBe(n);
      }),
      { examples: [[0]] },
    );
  });

  it("a conversion never rounds: the result is exactly quantity × factor, or the conversion is rejected", () => {
    fc.assert(
      fc.property(millionths, factor, (m, f) => {
        const exact = m * BigInt(f);
        if (exact % MILLION === 0n) {
          expect(BigInt(convertMillionths(m, f)) * MILLION).toBe(exact);
        } else {
          expect(() => convertMillionths(m, f)).toThrow(/not a whole number/);
        }
      }),
    );
  });

  it("converting a negative quantity gives exactly the negative of converting the positive one", () => {
    fc.assert(
      fc.property(
        factor,
        fc.bigInt({ min: -1_000_000n, max: 1_000_000n }),
        (f, n) => {
          const m = n * (MILLION / gcd(BigInt(f), MILLION)); // converts to whole base units
          // 0 − x rather than −x: −0 and 0 are different numbers to toBe.
          expect(convertMillionths(-m, f)).toBe(0 - convertMillionths(m, f));
        },
      ),
    );
  });
});
