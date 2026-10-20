import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mappingRefusal, matchLine, type Offer, type ReadLine } from "./match";

// Matching a read line to one of the supplier's supplier products, and whether a mapping can be
// remembered (#117, decision 0035). Pure: the database tests are in matching.test.ts.

const offer = (
  id: string,
  code: string | null,
  description: string,
  usable = true,
): Offer => ({ id, code, description, usable });

const line = (
  supplierCode: string | null,
  description: string | null,
): ReadLine => ({ supplierCode, description });

describe("matchLine", () => {
  const offers = [
    offer("tomate-kg", "T-01", "Tomate pera, kilo"),
    offer("tomate-caja", null, "Tomate pera"),
    offer("aceite", "A-05", "Aceite de oliva 5 l"),
  ];

  it("by code first, whatever the description says", () => {
    expect(matchLine(line("T-01", "Tomate pera"), offers)).toEqual({
      by: "code",
      offerId: "tomate-kg",
    });
  });

  it("a code is compared trimmed, and exactly: its case counts", () => {
    expect(matchLine(line("  A-05 ", null), offers)?.offerId).toBe("aceite");
    expect(matchLine(line("a-05", null), offers)).toBeNull();
  });

  it("by exact description when the code is unknown or missing", () => {
    expect(matchLine(line("X-99", "Tomate pera"), offers)).toEqual({
      by: "description",
      offerId: "tomate-caja",
    });
    expect(matchLine(line(null, "Tomate pera"), offers)?.offerId).toBe(
      "tomate-caja",
    );
  });

  it("a description ignores case and runs of spaces, but not accents", () => {
    expect(matchLine(line(null, "  TOMATE   pera "), offers)?.offerId).toBe(
      "tomate-caja",
    );
    const lemons = [offer("limon", null, "Limón")];
    expect(matchLine(line(null, "LIMÓN"), lemons)?.offerId).toBe("limon");
    expect(matchLine(line(null, "Limon"), lemons)).toBeNull();
  });

  it("a description two supplier products share matches neither", () => {
    const twoPacks = [
      offer("caja-6", "T-6", "Tomate pera"),
      offer("caja-3", "T-3", "Tomate pera"),
    ];
    expect(matchLine(line(null, "Tomate pera"), twoPacks)).toBeNull();
    expect(matchLine(line("T-3", "Tomate pera"), twoPacks)?.offerId).toBe(
      "caja-3",
    );
  });

  it("ignores supplier products that aren't usable (inactive, or of an inactive product)", () => {
    const old = [
      offer("old", "T-01", "Tomate pera", false),
      offer("new", "T-02", "Tomate pera"),
    ];
    expect(matchLine(line("T-01", "Otra cosa"), old)).toBeNull();
    expect(matchLine(line("T-01", "Tomate pera"), old)).toEqual({
      by: "description",
      offerId: "new",
    });
  });

  it("a line with neither a code nor a description matches nothing", () => {
    expect(matchLine(line(null, null), offers)).toBeNull();
    expect(matchLine(line("  ", "  "), [offer("blank", null, "")])).toBeNull();
  });
});

describe("mappingRefusal", () => {
  it("a code already the supplier's, even an inactive supplier product's, is taken", () => {
    expect(
      mappingRefusal(line(" T-01 ", "Tomate"), [
        offer("old", "T-01", "Otra", false),
      ]),
    ).toEqual({ code: "taken" });
  });

  it("a line without a code: its description is taken if a usable supplier product has it", () => {
    const offers = [offer("t", "T-01", "Tomate pera")];
    expect(mappingRefusal(line(null, "TOMATE  PERA"), offers)).toEqual({
      description: "taken",
    });
    expect(
      mappingRefusal(line(null, "Tomate pera"), [
        offer("t", "T-01", "Tomate pera", false),
      ]),
    ).toBeNull();
  });

  it("a line with a new code may share a description: its code tells it apart", () => {
    expect(
      mappingRefusal(line("T-02", "Tomate pera"), [
        offer("t", "T-01", "Tomate pera"),
      ]),
    ).toBeNull();
  });
});

// Codes and descriptions from a few letters, with spaces and case changed, so that they collide.
const text = fc
  .tuple(
    fc.constantFrom("", " ", "  "),
    fc.constantFrom("a", "b", "A", "B", "a b", "A  b", "á"),
    fc.constantFrom("", " "),
  )
  .map(([before, core, after]) => `${before}${core}${after}`);
const code = fc.option(text, { nil: null });
const offers = fc
  .array(fc.record({ code, description: text, usable: fc.boolean() }), {
    maxLength: 8,
  })
  .map((rows) =>
    rows
      // Codes are stored trimmed, blank as none, and unique per supplier: the database's rule.
      .map((row) => ({ ...row, code: row.code?.trim() || null }))
      .filter(
        (row, i, all) =>
          row.code === null || all.findIndex((r) => r.code === row.code) === i,
      )
      .map((row, i): Offer => ({ id: `offer-${i}`, ...row })),
  );

describe("properties", () => {
  it("a line whose code is one of the supplier's usable supplier products' always matches that one by code, whatever the descriptions say", () => {
    fc.assert(
      fc.property(
        offers,
        fc.nat(),
        fc.option(text, { nil: null }),
        (all, pick, description) => {
          const coded = all.filter((o) => o.usable && o.code !== null);
          fc.pre(coded.length > 0);
          const chosen = coded[pick % coded.length]!;
          expect(matchLine(line(` ${chosen.code} `, description), all)).toEqual(
            { by: "code", offerId: chosen.id },
          );
        },
      ),
    );
  });

  it("once a mapping is confirmed, the same line matches the supplier product it made", () => {
    fc.assert(
      fc.property(offers, code, text, (all, lineCode, description) => {
        const read = line(lineCode, description);
        fc.pre(description.trim() !== "");
        fc.pre(mappingRefusal(read, all) === null);
        const remembered: Offer = {
          id: "remembered",
          code: lineCode?.trim() || null,
          description: description.trim(),
          usable: true,
        };
        expect(matchLine(read, [...all, remembered])?.offerId).toBe(
          "remembered",
        );
      }),
    );
  });

  it("never matches a supplier product that isn't usable", () => {
    fc.assert(
      fc.property(offers, code, text, (all, lineCode, description) => {
        const found = matchLine(line(lineCode, description), all);
        if (found) {
          expect(all.find((o) => o.id === found.offerId)?.usable).toBe(true);
        }
      }),
    );
  });
});
