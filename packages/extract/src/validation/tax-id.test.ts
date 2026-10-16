import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { checkSpanishTaxId } from "./tax-id";

// Control characters worked out by hand:
// - NIF: the 8 digits mod 23, looked up in "TRWAGMYFPDXBNJZSQVHLCKE". 12345678 mod 23 = 14 → Z.
// - NIE: X, Y, Z count as 0, 1, 2, then as a NIF. 01234567 mod 23 = 19 → L;
//   11234567 mod 23 = 10 → X; 21234567 mod 23 = 1 → R.
// - CIF: from the 7 digits, add the even positions, and the digit sums of twice each odd
//   position; the control is (10 − sum mod 10) mod 10, as a digit or as "JABCDEFGHI"[control].
//   0012345: odd 0,1,3,5 → 0+2+6+(1+0) = 9; even 0,2,4 → 6; sum 15 → control 5 → B…5 or P…E.
//   Province 00 doesn't exist, so these CIFs belong to no real company.

describe("checkSpanishTaxId: NIF, NIE and CIF control characters", () => {
  it("valid: NIF 12345678Z, NIEs X1234567L, Y1234567X and Z1234567R, CIFs B00123455 and P0012345E", () => {
    expect(checkSpanishTaxId("12345678Z")).toEqual({
      valid: true,
      kind: "NIF",
    });
    for (const nie of ["X1234567L", "Y1234567X", "Z1234567R"]) {
      expect(checkSpanishTaxId(nie)).toEqual({ valid: true, kind: "NIE" });
    }
    expect(checkSpanishTaxId("B00123455")).toEqual({
      valid: true,
      kind: "CIF",
    });
    expect(checkSpanishTaxId("P0012345E")).toEqual({
      valid: true,
      kind: "CIF",
    });
  });

  it("a Spanish ES prefix is allowed: ESB00123455", () => {
    expect(checkSpanishTaxId("ESB00123455")).toEqual({
      valid: true,
      kind: "CIF",
    });
  });

  it("wrong control characters: 12345678A, X1234567A, B00123456", () => {
    for (const taxId of ["12345678A", "X1234567A", "B00123456"]) {
      expect(checkSpanishTaxId(taxId)).toMatchObject({ valid: false });
    }
  });

  it("a CIF's control must be a digit for A, B, E, H, and a letter for P, Q, S, N, W; either for the others", () => {
    expect(checkSpanishTaxId("B0012345E")).toMatchObject({ valid: false });
    expect(checkSpanishTaxId("P00123455")).toMatchObject({ valid: false });
    expect(checkSpanishTaxId("G00123455")).toEqual({
      valid: true,
      kind: "CIF",
    });
    expect(checkSpanishTaxId("G0012345E")).toEqual({
      valid: true,
      kind: "CIF",
    });
  });

  it("a foreign tax ID can't be verified: FR12345678901", () => {
    expect(checkSpanishTaxId("FR12345678901")).toEqual({
      valid: false,
      reason: "a foreign tax ID (FR) can't be verified",
    });
  });

  it("anything else is not a NIF, NIE or CIF", () => {
    for (const taxId of ["", "1234567Z", "ABCDEFGHI", "I00123455"]) {
      expect(checkSpanishTaxId(taxId)).toMatchObject({ valid: false });
    }
  });
});

const NIF_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_LETTERS = "JABCDEFGHI";
const digits = (length: number) =>
  fc.string({
    unit: fc.constantFrom(..."0123456789"),
    minLength: length,
    maxLength: length,
  });

function cifControl(sevenDigits: string): number {
  let sum = 0;
  [...sevenDigits].forEach((c, i) => {
    const d = Number(c);
    if (i % 2 === 1) sum += d;
    else sum += Math.floor((2 * d) / 10) + ((2 * d) % 10);
  });
  return (10 - (sum % 10)) % 10;
}

// Valid IDs of each kind, built with the rules above.
const validTaxId = fc.oneof(
  digits(8).map((d) => `${d}${NIF_LETTERS[Number(d) % 23]}`),
  fc
    .tuple(fc.constantFrom("X", "Y", "Z"), digits(7))
    .map(
      ([p, d]) =>
        `${p}${d}${NIF_LETTERS[Number(`${"XYZ".indexOf(p)}${d}`) % 23]}`,
    ),
  fc
    .tuple(fc.constantFrom(..."ABEH"), digits(7))
    .map(([l, d]) => `${l}${d}${cifControl(d)}`),
  fc
    .tuple(fc.constantFrom(..."PQSNW"), digits(7))
    .map(([l, d]) => `${l}${d}${CIF_LETTERS[cifControl(d)]}`),
);

describe("tax ID properties", () => {
  it("every generated NIF, NIE and CIF is valid", () => {
    fc.assert(
      fc.property(validTaxId, (taxId) => {
        expect(checkSpanishTaxId(taxId)).toMatchObject({ valid: true });
      }),
    );
  });

  it("a valid tax ID with any one digit, or its control character, changed (to another of the same kind: digit for digit, letter for letter) fails", () => {
    fc.assert(
      fc.property(
        validTaxId,
        fc.nat(),
        fc.integer({ min: 1, max: 25 }),
        (taxId, pick, shift) => {
          // Positions that can change: every digit, and the last character.
          const positions = [...taxId]
            .map((c, i) => ({ c, i }))
            .filter(({ c, i }) => /\d/.test(c) || i === taxId.length - 1);
          const { c, i } = positions[pick % positions.length]!;
          const replacement = /\d/.test(c)
            ? String((Number(c) + (shift % 9) + 1) % 10)
            : String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65);
          const changed = taxId.slice(0, i) + replacement + taxId.slice(i + 1);
          expect(checkSpanishTaxId(changed)).toMatchObject({ valid: false });
        },
      ),
    );
  });
});
