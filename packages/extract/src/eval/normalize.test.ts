import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  canonicalDecimal,
  sameDate,
  sameDecimal,
  sameDocumentNumber,
  sameText,
} from "./normalize";

describe("decimals compare by value, never as JavaScript numbers", () => {
  it.each([
    ["1.50", "1.5"],
    ["01.5", "1.5"],
    ["21.00", "21"],
    ["-0", "0"],
    ["-0.00", "0"],
    ["100", "100.0"],
    ["12345678901234567890.1", "12345678901234567890.10"],
  ])("%s equals %s", (a, b) => {
    expect(sameDecimal(a, b)).toBe(true);
  });

  it.each([
    ["1.5", "1.05"],
    ["-1.5", "1.5"],
    ["10", "1"],
    // Beyond what a double can tell apart: compared as text, they still differ.
    ["12345678901234567890.1", "12345678901234567890.2"],
  ])("%s doesn't equal %s", (a, b) => {
    expect(sameDecimal(a, b)).toBe(false);
  });

  it("null means not printed: it only equals null", () => {
    expect(sameDecimal(null, null)).toBe(true);
    expect(sameDecimal(null, "0")).toBe(false);
    expect(sameDecimal("0", null)).toBe(false);
  });

  it("the canonical form drops leading zeros, trailing decimal zeros and a minus on zero", () => {
    expect(canonicalDecimal("-007.2500")).toBe("-7.25");
    expect(canonicalDecimal("0.000")).toBe("0");
    expect(canonicalDecimal("-0.0")).toBe("0");
  });

  it("anything that isn't a decimal is only equal to itself", () => {
    expect(sameDecimal("1,5", "1.5")).toBe(false);
    expect(sameDecimal("abc", "abc")).toBe(true);
  });

  const parts = fc.tuple(
    fc.boolean(),
    fc.nat({ max: 999_999 }),
    fc.string({ unit: fc.constantFrom(..."0123456789"), maxLength: 6 }),
  );
  const write = (negative: boolean, whole: string, fraction: string) =>
    `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`;

  it("leading zeros and trailing decimal zeros never change the value", () => {
    fc.assert(
      fc.property(
        parts,
        fc.nat({ max: 3 }),
        fc.nat({ max: 3 }),
        ([negative, whole, fraction], lead, trail) => {
          const plain = write(negative, `${whole}`, fraction);
          const padded = write(
            negative,
            "0".repeat(lead) + `${whole}`,
            fraction + "0".repeat(trail),
          );
          expect(sameDecimal(plain, padded)).toBe(true);
        },
      ),
    );
  });

  it("adding a non-zero digit at the end of the decimals always changes the value", () => {
    fc.assert(
      fc.property(
        parts,
        fc.constantFrom(..."123456789"),
        ([negative, whole, fraction], digit) => {
          const value = write(negative, `${whole}`, fraction);
          const changed = write(negative, `${whole}`, fraction + digit);
          expect(sameDecimal(value, changed)).toBe(false);
        },
      ),
    );
  });
});

describe("text ignores case and repeated spaces, nothing else", () => {
  it("case, spaces at the ends and runs of spaces don't count", () => {
    expect(sameText("Aceite  de OLIVA ", "aceite de oliva")).toBe(true);
    expect(sameText("Ñora", "ñora")).toBe(true);
  });

  it("accents and punctuation do: a model that drops them read something else", () => {
    expect(sameText("Salmón", "Salmon")).toBe(false);
    expect(sameText("pack 6", "pack-6")).toBe(false);
  });

  it("null only equals null", () => {
    expect(sameText(null, null)).toBe(true);
    expect(sameText(null, "a")).toBe(false);
  });
});

describe("dates compare as dates", () => {
  it("the same day, and only the same day", () => {
    expect(sameDate("2026-10-05", "2026-10-05")).toBe(true);
    expect(sameDate("2026-10-05", "2026-10-06")).toBe(false);
    expect(sameDate("2026-10-05", "2026-05-10")).toBe(false);
    expect(sameDate(null, null)).toBe(true);
    expect(sameDate(null, "2026-10-05")).toBe(false);
  });
});

describe("document numbers compare like the duplicate check does", () => {
  it("ignoring case and spaces", () => {
    expect(sameDocumentNumber("f - 1", "F-1")).toBe(true);
  });

  it("and the separators -, / and . (#58)", () => {
    expect(sameDocumentNumber("LI26-0482", "LI260482")).toBe(true);
    expect(sameDocumentNumber("LI26/0482", "li26.0482")).toBe(true);
    expect(sameDocumentNumber("F1", "F10")).toBe(false);
  });
});
