import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatUnitCost,
} from "./format";

// A no-break space (U+00A0) goes before "€", "kg" and "%", so a line never wraps between them.
const NBSP = " ";

/** Whole cents read back from "-1.234,56 €": every digit, and the sign. Inverse of formatMoney. */
function centsFromSpanish(text: string): bigint {
  return BigInt(text.replace(/[^\d-]/g, ""));
}

/** "18,5" → 18500n: a Spanish number read as thousandths, exactly. */
function thousandthsFromSpanish(amount: string): bigint {
  const negative = amount.startsWith("-");
  const [whole, fraction = ""] = amount.replace(/[-.]/g, "").split(",");
  const value = BigInt(whole! + fraction.padEnd(3, "0"));
  return negative ? -value : value;
}

/** A decimal string with exactly `scale` decimals, from a whole number of the smallest unit. */
function decimal(units: bigint, scale: number): string {
  const sign = units < 0n ? "-" : "";
  const digits = (units < 0n ? -units : units)
    .toString()
    .padStart(scale + 1, "0");
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/** Spanish grouping: 1 to 3 digits, then groups of exactly 3 after a "." each. */
const SPANISH_MONEY = new RegExp(`^-?\\d{1,3}(\\.\\d{3})*,\\d{2}${NBSP}€$`);

// Well beyond Number.MAX_SAFE_INTEGER (2^53 - 1) in both directions.
const anyCents = fc.bigInt({ min: -(2n ** 80n), max: 2n ** 80n });

describe("formatMoney: euros the Spanish way, never through a number", () => {
  it("formats the issue's example, from cents or from the API's decimal string", () => {
    expect(formatMoney(123456n, "es")).toBe(`1.234,56${NBSP}€`);
    expect(formatMoney("1234.56", "es")).toBe(`1.234,56${NBSP}€`);
  });

  it("groups four-digit amounts too, which es-ES leaves ungrouped by default", () => {
    expect(formatMoney("1234.00", "es")).toBe(`1.234,00${NBSP}€`);
    expect(formatMoney("999.99", "es")).toBe(`999,99${NBSP}€`);
  });

  it("always shows 2 decimals, and pads a decimal string that has fewer", () => {
    expect(formatMoney(0n, "es")).toBe(`0,00${NBSP}€`);
    expect(formatMoney(5n, "es")).toBe(`0,05${NBSP}€`);
    expect(formatMoney("12.5", "es")).toBe(`12,50${NBSP}€`);
    expect(formatMoney("12", "es")).toBe(`12,00${NBSP}€`);
  });

  it("shows negatives with a minus, but never a negative zero", () => {
    expect(formatMoney(-123456n, "es")).toBe(`-1.234,56${NBSP}€`);
    expect(formatMoney("-0.01", "es")).toBe(`-0,01${NBSP}€`);
    expect(formatMoney("-0.00", "es")).toBe(`0,00${NBSP}€`);
  });

  it("in English: €1,234.56", () => {
    expect(formatMoney(123456n, "en")).toBe("€1,234.56");
    expect(formatMoney(-50n, "en")).toBe("-€0.50");
  });

  it("refuses a third decimal instead of rounding it, and anything that isn't a decimal", () => {
    expect(() => formatMoney("12.505", "es")).toThrow(RangeError);
    for (const text of ["", "12,50", "1e3", " 12.50", "12.", ".5", "NaN"]) {
      expect(() => formatMoney(text, "es"), JSON.stringify(text)).toThrow(
        RangeError,
      );
    }
  });

  it("any amount of cents, beyond 2^53 and negative: reading it back gives the same cents", () => {
    fc.assert(
      fc.property(anyCents, (cents) => {
        expect(centsFromSpanish(formatMoney(cents, "es"))).toBe(cents);
      }),
    );
  });

  it("any decimal string with 2 decimals: reading it back gives the same amount", () => {
    fc.assert(
      fc.property(anyCents, (cents) => {
        const text = formatMoney(decimal(cents, 2), "es");
        expect(centsFromSpanish(text)).toBe(cents);
      }),
    );
  });

  it("any amount: groups of 3 digits split by '.', and ',' before exactly 2 decimals", () => {
    fc.assert(
      fc.property(anyCents, (cents) => {
        expect(formatMoney(cents, "es")).toMatch(SPANISH_MONEY);
      }),
    );
  });
});

describe("formatUnitCost: what a kilo, a litre or a unit costs", () => {
  it("turns a cost per gram into one per kilo, exactly: 0.0185 €/g is 18,50 €/kg", () => {
    expect(formatUnitCost("0.018500", "g", "es")).toBe(`18,50${NBSP}€/kg`);
    expect(formatUnitCost("0.0185", "ml", "es")).toBe(`18,50${NBSP}€/l`);
    expect(formatUnitCost("0.0185", "g", "en")).toBe("€18.50/kg");
  });

  it("a cost per thousandth of a unit becomes a cost per unit", () => {
    expect(formatUnitCost("0.000250", "unit", "es")).toBe(`0,25${NBSP}€/ud.`);
    expect(formatUnitCost("0.000250", "unit", "en")).toBe("€0.25/unit");
  });

  it("keeps all 6 decimals of the cost: the smallest one is 0,001 €/kg", () => {
    expect(formatUnitCost("0.000001", "g", "es")).toBe(`0,001${NBSP}€/kg`);
    expect(formatUnitCost("1.234567", "g", "es")).toBe(`1.234,567${NBSP}€/kg`);
  });

  it("refuses a seventh decimal instead of rounding it", () => {
    expect(() => formatUnitCost("0.0000001", "g", "es")).toThrow(RangeError);
  });

  it("any cost with up to 6 decimals: the cost per kilo is exactly 1000 times it", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 70n }), (millionths) => {
        const text = formatUnitCost(decimal(millionths, 6), "g", "es");
        const amount = text.replace(`${NBSP}€/kg`, "");
        // Per kilo in thousandths of a euro = per gram in millionths of a euro.
        expect(thousandthsFromSpanish(amount)).toBe(millionths);
      }),
    );
  });
});

describe("formatQuantity: a quantity in its base unit, the way a kitchen says it", () => {
  it("1000 g or more is shown in kilos, and 1000 ml or more in litres", () => {
    expect(formatQuantity(2500, "g", "es")).toBe(`2,5${NBSP}kg`);
    expect(formatQuantity(1000, "g", "es")).toBe(`1${NBSP}kg`);
    expect(formatQuantity(999, "g", "es")).toBe(`999${NBSP}g`);
    expect(formatQuantity(1250, "ml", "es")).toBe(`1,25${NBSP}l`);
    expect(formatQuantity(750, "ml", "es")).toBe(`750${NBSP}ml`);
    expect(formatQuantity(1234567, "g", "es")).toBe(`1.234,567${NBSP}kg`);
  });

  it("returns (negative) are shown in kilos from -1000 g too", () => {
    expect(formatQuantity(-1500, "g", "es")).toBe(`-1,5${NBSP}kg`);
    expect(formatQuantity(-999, "g", "es")).toBe(`-999${NBSP}g`);
  });

  it("units are counted in thousandths: 3000 is 3 units, 500 is half a unit", () => {
    expect(formatQuantity(3000, "unit", "es")).toBe(`3${NBSP}uds.`);
    expect(formatQuantity(1000, "unit", "es")).toBe(`1${NBSP}ud.`);
    expect(formatQuantity(500, "unit", "es")).toBe(`0,5${NBSP}uds.`);
    expect(formatQuantity(3000, "unit", "en")).toBe(`3${NBSP}units`);
    expect(formatQuantity(1000, "unit", "en")).toBe(`1${NBSP}unit`);
  });

  it("in English: 2.5 kg", () => {
    expect(formatQuantity(2500, "g", "en")).toBe(`2.5${NBSP}kg`);
  });

  it("refuses a quantity that isn't a whole number of base units", () => {
    expect(() => formatQuantity(2.5, "g", "es")).toThrow(RangeError);
    expect(() => formatQuantity(2 ** 53, "g", "es")).toThrow(RangeError);
  });

  it("any quantity: the amount shown, in its unit, is exactly the base units it came from", () => {
    const scale: Record<string, bigint> = {
      kg: 1000n,
      g: 1n,
      l: 1000n,
      ml: 1n,
      "ud.": 1000n,
      "uds.": 1000n,
    };
    fc.assert(
      fc.property(
        fc.maxSafeInteger(),
        fc.constantFrom("g" as const, "ml" as const, "unit" as const),
        (quantity, baseUnit) => {
          const [amount, unit] = formatQuantity(quantity, baseUnit, "es").split(
            NBSP,
          );
          // thousandths × (base units per shown unit) ÷ 1000 = base units
          const base =
            (thousandthsFromSpanish(amount!) * scale[unit!]!) / 1000n;
          expect(base).toBe(BigInt(quantity));
        },
      ),
    );
  });
});

describe("dates, times and percentages", () => {
  it("a date is day/month/year, and never moves a day with the time zone", () => {
    expect(formatDate("2026-10-18", "es")).toBe("18/10/2026");
    expect(formatDate("2026-01-01", "es")).toBe("01/01/2026");
    expect(formatDate("2026-10-18", "en")).toBe("18/10/2026");
  });

  it("refuses a date that isn't YYYY-MM-DD", () => {
    for (const text of ["18/10/2026", "2026-13-01", "2026-02-30", ""]) {
      expect(() => formatDate(text, "es"), text).toThrow(RangeError);
    }
  });

  it("a moment is shown in the restaurant's time, Madrid, in winter and in summer", () => {
    expect(formatDateTime("2026-10-18T18:05:00Z", "es")).toBe(
      "18/10/2026, 20:05",
    );
    expect(formatDateTime("2026-01-18T23:30:00Z", "es")).toBe(
      "19/01/2026, 00:30",
    );
  });

  it("refuses a moment that isn't a valid ISO timestamp", () => {
    expect(() => formatDateTime("yesterday", "es")).toThrow(RangeError);
  });

  it("a percentage keeps its decimals: 5,5 %", () => {
    expect(formatPercent("5.5", "es")).toBe(`5,5${NBSP}%`);
    expect(formatPercent("12.25", "es")).toBe(`12,25${NBSP}%`);
    expect(formatPercent("0", "es")).toBe(`0${NBSP}%`);
    expect(formatPercent("5.5", "en")).toBe("5.5%");
  });

  it("refuses a percentage with more than 2 decimals", () => {
    expect(() => formatPercent("5.555", "es")).toThrow(RangeError);
  });
});
