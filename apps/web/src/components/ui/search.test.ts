import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeForSearch } from "./search";

describe("matchesSearch: whether an option matches what was typed in a search box", () => {
  it("ignores case and accents: 'limon' finds 'Limón', 'pina' finds 'Piña'", () => {
    expect(matchesSearch("Limón", "limon")).toBe(true);
    expect(matchesSearch("Piña", "PINA")).toBe(true);
    expect(matchesSearch("Aceite de oliva", "ACEITE")).toBe(true);
  });

  it("finds each typed word anywhere, in any order", () => {
    expect(matchesSearch("Aceite de oliva virgen extra", "oliva aceite")).toBe(
      true,
    );
    expect(matchesSearch("Aceite de oliva", "oliva girasol")).toBe(false);
  });

  it("an empty search matches everything", () => {
    expect(matchesSearch("Tomate", "")).toBe(true);
    expect(matchesSearch("Tomate", "   ")).toBe(true);
  });

  it("any Spanish text matches itself, in capitals and without its accents", () => {
    const spanish = fc.string({
      unit: fc.constantFrom(..."abcdefghijklmnñopqrstuvwxyzáéíóúü "),
    });
    fc.assert(
      fc.property(spanish, (text) => {
        const plain = text.normalize("NFD").replace(/\p{M}/gu, "");
        expect(matchesSearch(text, text)).toBe(true);
        expect(matchesSearch(text, plain.toUpperCase())).toBe(true);
        expect(matchesSearch(plain, text)).toBe(true);
      }),
    );
  });

  it("normalizeForSearch lowercases, strips accents and squeezes spaces", () => {
    expect(normalizeForSearch("  Crème   Brûlée ")).toBe("creme brulee");
  });
});
