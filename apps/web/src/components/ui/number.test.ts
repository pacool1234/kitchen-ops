import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canonicalDecimal,
  formatDecimalInput,
  parseDecimalInput,
} from "./number";

const parse = (text: string, options = {}) =>
  parseDecimalInput(text, { maxDecimals: 3, allowNegative: false, ...options });

describe("parseDecimalInput: what was typed in a number field, as a decimal string", () => {
  it("takes a comma or a point as the decimal separator, in either language", () => {
    expect(parse("2,5")).toEqual({ ok: true, value: "2.5" });
    expect(parse("2.5")).toEqual({ ok: true, value: "2.5" });
    expect(parse(" 12,750 ")).toEqual({ ok: true, value: "12.75" });
  });

  it("writes it the same way however it was typed: no leading or trailing zeros", () => {
    expect(parse("02,50")).toEqual({ ok: true, value: "2.5" });
    expect(parse("0,000")).toEqual({ ok: true, value: "0" });
    expect(parse(",5")).toEqual({ ok: true, value: "0.5" });
    expect(parse("5,")).toEqual({ ok: true, value: "5" });
  });

  it("an empty field is an empty value, not zero", () => {
    expect(parse("")).toEqual({ ok: true, value: "" });
    expect(parse("   ")).toEqual({ ok: true, value: "" });
  });

  it("refuses thousands separators, which would make 1.234 ambiguous, and anything else", () => {
    for (const text of [
      "1.234,5",
      "1,234.5",
      "1 234",
      "abc",
      "1e3",
      "2,5 kg",
      ",",
      "--1",
      "0x10",
    ]) {
      expect(parse(text), text).toEqual({ ok: false, error: "invalid" });
    }
  });

  it("refuses more decimals than the field allows, instead of rounding", () => {
    expect(parse("2,5678")).toEqual({ ok: false, error: "tooManyDecimals" });
    expect(parse("2,567")).toEqual({ ok: true, value: "2.567" });
    expect(parse("2,5", { maxDecimals: 0 })).toEqual({
      ok: false,
      error: "tooManyDecimals",
    });
  });

  it("takes a negative only where the field allows one, and never a negative zero", () => {
    expect(parse("-2,5")).toEqual({ ok: false, error: "negative" });
    expect(parse("-2,5", { allowNegative: true })).toEqual({
      ok: true,
      value: "-2.5",
    });
    expect(parse("-0,0", { allowNegative: true })).toEqual({
      ok: true,
      value: "0",
    });
  });

  it("any decimal: shown in the field in either language and read back, it's the same decimal", () => {
    const decimal = fc
      .tuple(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.integer({ min: 0, max: 3 }),
      )
      .map(([units, scale]) => {
        const digits = (units < 0n ? -units : units)
          .toString()
          .padStart(scale + 1, "0");
        const sign = units < 0n ? "-" : "";
        return scale === 0
          ? `${sign}${digits}`
          : `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
      });
    fc.assert(
      fc.property(
        decimal,
        fc.constantFrom("es" as const, "en" as const),
        (value, locale) => {
          const shown = formatDecimalInput(value, locale);
          expect(parse(shown, { allowNegative: true })).toEqual({
            ok: true,
            value: canonicalDecimal(value),
          });
        },
      ),
    );
  });

  it("any text: what it accepts, read again, gives the same value", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom(..."0123456789,.- ") }),
        (text) => {
          const first = parse(text, { allowNegative: true });
          if (first.ok) {
            expect(parse(first.value, { allowNegative: true })).toEqual(first);
          }
        },
      ),
    );
  });
});

describe("formatDecimalInput: a decimal string as a number field shows it", () => {
  it("with the language's decimal separator, and no grouping, so it can be edited", () => {
    expect(formatDecimalInput("1234.5", "es")).toBe("1234,5");
    expect(formatDecimalInput("1234.5", "en")).toBe("1234.5");
    expect(formatDecimalInput("", "es")).toBe("");
  });
});
