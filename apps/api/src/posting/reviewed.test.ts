import * as ledger from "@kitchen-ops/ledger";
import type { ExtractedDocument, ExtractedLine } from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fakeDocument } from "../extraction/fake";
import {
  deliveryNoteToPost,
  ledgerLines,
  type MatchedLine,
  type ReviewedDocument,
} from "./reviewed";

// A reviewed delivery note's draft, as posting takes it (#119, decision 0038): each line at its
// supplier product's pack, into the storeroom chosen for it or its product's default, at 0 when
// it shows no price. Pure: the endpoint's tests are in routes.test.ts.

const SUPPLIER = "0199a000-0000-7000-8000-00000000000a";
const COLD_ROOM = "0199a000-0000-7000-8000-00000000000b";
const DRY_STORE = "0199a000-0000-7000-8000-00000000000c";
const TOMATOES = "0199a000-0000-7000-8000-00000000000d";
const BOX = "0199a000-0000-7000-8000-00000000000e";

/** Tomatoes, bought from the supplier by the 6 kg box; kept in the cold room. */
const tomatoBox: MatchedLine = {
  supplierProductId: BOX,
  productId: TOMATOES,
  packBaseUnits: 6000,
  defaultStoreroomId: COLD_ROOM,
};

const draftOf = (...lines: Partial<ExtractedLine>[]): ExtractedDocument => {
  const read = fakeDocument("2026-10-20");
  return {
    ...read,
    lines: lines.map((line) => ({ ...read.lines[0]!, ...line })),
  };
};

function posted(document: ReviewedDocument) {
  const ids = document.lines.map((_, i) => `line-${i + 1}`);
  const { lines, conversions } = ledgerLines(document, ids);
  let n = 0;
  const result = ledger.postDocument(
    {
      id: "document",
      type: "delivery-note",
      status: "review",
      date: document.date,
      supplierId: document.supplierId,
      storeroomId: document.storeroomId,
      lines,
    },
    { movements: [], conversions, newId: () => `movement-${++n}` },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.movements;
}

function toPost(
  draft: ExtractedDocument,
  matched: readonly MatchedLine[],
  storerooms: readonly (string | null)[] = matched.map(() => null),
) {
  return deliveryNoteToPost({
    draft,
    supplierId: SUPPLIER,
    matched,
    storerooms,
  });
}

function document(result: ReturnType<typeof toPost>): ReviewedDocument {
  if (!result.ok) throw new Error(JSON.stringify(result.fields));
  return result.document;
}

/** A decimal with up to `decimals` places, as printed: "12.5". */
const decimal = (max: number, decimals: number) =>
  fc
    .tuple(
      fc.integer({ min: 0, max }),
      fc.integer({ min: 0, max: 10 ** decimals - 1 }),
    )
    .map(([whole, fraction]) =>
      decimals === 0
        ? String(whole)
        : `${whole}.${String(fraction).padStart(decimals, "0")}`,
    );

describe("deliveryNoteToPost: a delivery note's draft as it's posted", () => {
  it("each line is received at its pack: its base units are the printed quantity times the pack's, and its cost is the checks' line total divided by them", () => {
    fc.assert(
      fc.property(
        // Thousandths of a box of 1000 × k base units: always whole.
        decimal(50, 3).filter((q) => q !== "0.000"),
        fc.integer({ min: 1, max: 20 }),
        decimal(500, 2),
        fc.option(fc.integer({ min: 0, max: 50 }).map(String), { nil: null }),
        (quantity, k, unitPrice, discountPercent) => {
          const pack = { ...tomatoBox, packBaseUnits: 1000 * k };
          const line = { quantity, unit: "caja", unitPrice, discountPercent };
          const [movement] = posted(document(toPost(draftOf(line), [pack])));
          // The quantity has 3 decimals: as thousandths, it's the digits without the point.
          const thousandths = BigInt(quantity.replace(".", ""));
          expect(BigInt(movement!.quantity)).toBe(
            (thousandths * BigInt(pack.packBaseUnits)) / 1000n,
          );
          const total = ledger.lineTotal({
            quantity,
            unitPrice: ledger.parseUnitCost(unitPrice),
            ...(discountPercent === null ? {} : { discountPercent }),
          });
          expect(movement!.unitCost).toBe(
            ledger.receivedUnitCost(total, movement!.quantity),
          );
        },
      ),
    );
  });

  it("example: 1.5 boxes of 6 kg at €12.00 a box is 9000 g at €18.00 in all, €0.002 a gram", () => {
    const [movement] = posted(
      document(
        toPost(draftOf({ quantity: "1.5", unit: "caja", unitPrice: "12.00" }), [
          tomatoBox,
        ]),
      ),
    );
    expect(movement!.quantity).toBe(9000);
    expect(ledger.formatUnitCost(movement!.unitCost)).toBe("0.002000");
  });

  it("the pack's price isn't divided: €12.37 a 6 kg box is still €12.37 for the box, not €2.061667 a kg", () => {
    const [movement] = posted(
      document(
        toPost(draftOf({ quantity: "1", unit: "caja", unitPrice: "12.37" }), [
          tomatoBox,
        ]),
      ),
    );
    // 12.37 / 6000 g = 0.0020616…, rounded once, at the received unit cost (decision 0015).
    expect(ledger.formatUnitCost(movement!.unitCost)).toBe("0.002062");
  });

  it("the line keeps its quantity and unit as printed, and the supplier product it was matched to", () => {
    const { lines } = document(
      toPost(draftOf({ quantity: "1.5", unit: "caja" }), [tomatoBox]),
    );
    expect(lines[0]).toMatchObject({
      productId: TOMATOES,
      quantity: "1.5",
      unit: "caja",
      supplierProduct: { id: BOX, baseUnitsPerUnit: 6000 },
    });
  });

  it("a line with no price is received at zero cost", () => {
    fc.assert(
      fc.property(
        decimal(50, 3).filter((q) => q !== "0.000"),
        (quantity) => {
          const [movement] = posted(
            document(
              toPost(draftOf({ quantity, unitPrice: null, lineTotal: null }), [
                tomatoBox,
              ]),
            ),
          );
          expect(movement!.unitCost).toBe(0n);
        },
      ),
    );
  });

  it("each line goes to the storeroom chosen for it, otherwise to its product's default", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            chosen: fc.constantFrom(null, COLD_ROOM, DRY_STORE),
            fallback: fc.constantFrom(null, COLD_ROOM, DRY_STORE),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (lines) => {
          const matched = lines.map(({ fallback }) => ({
            ...tomatoBox,
            defaultStoreroomId: fallback,
          }));
          const result = toPost(
            draftOf(...lines.map(() => ({ quantity: "1" }))),
            matched,
            lines.map((l) => l.chosen),
          );
          const expected = lines.map((l) => l.chosen ?? l.fallback);
          if (expected.includes(null)) {
            expect(result).toEqual({
              ok: false,
              fields: Object.fromEntries(
                expected.flatMap((s, i) =>
                  s === null ? [[`lines.${i}.storeroomId`, "required"]] : [],
                ),
              ),
            });
          } else {
            const reviewed = document(result);
            expect(reviewed.lines.map((l) => l.storeroomId)).toEqual(expected);
            expect(posted(reviewed).map((m) => m.storeroomId)).toEqual(
              expected,
            );
          }
        },
      ),
    );
  });

  it("a quantity that isn't a whole number of base units is refused on its line: 0.0001 boxes of 6000 g", () => {
    expect(
      toPost(draftOf({ quantity: "1" }, { quantity: "0.0001" }), [
        tomatoBox,
        tomatoBox,
      ]),
    ).toEqual({
      ok: false,
      fields: { "lines.1.quantity": "not_whole_base_units" },
    });
  });

  it("the header is the draft's as it stands: its supplier, number and date", () => {
    const reviewed = document(toPost(draftOf({}), [tomatoBox], [DRY_STORE]));
    expect(reviewed).toMatchObject({
      type: "delivery-note",
      supplierId: SUPPLIER,
      number: "ALB-0001",
      date: "2026-10-20",
      storeroomId: DRY_STORE,
    });
  });

  it("discount and VAT go with the line when printed, and not when they aren't", () => {
    const { lines } = document(
      toPost(
        draftOf(
          { discountPercent: "5", vatRate: "10" },
          { discountPercent: null, vatRate: null },
        ),
        [tomatoBox, tomatoBox],
      ),
    );
    expect(lines[0]).toMatchObject({ discountPercent: "5", vatRate: "10" });
    expect(lines[1]).not.toHaveProperty("discountPercent");
    expect(lines[1]).not.toHaveProperty("vatRate");
  });
});

describe("ledgerLines: a reviewed document's lines as the ledger takes them", () => {
  it("two lines of one supplier product share its pack's conversion; a line without one uses the product's own", () => {
    const reviewed = document(
      toPost(draftOf({ quantity: "1" }, { quantity: "2" }), [
        tomatoBox,
        tomatoBox,
      ]),
    );
    const plain = {
      productId: TOMATOES,
      quantity: "3",
      unit: "kg",
      unitPrice: ledger.parseUnitCost("0"),
    };
    const { lines, conversions } = ledgerLines(
      { ...reviewed, lines: [...reviewed.lines, plain] },
      ["a", "b", "c"],
    );
    expect(conversions).toEqual([
      { productId: TOMATOES, unit: lines[0]!.unit, factor: 6000 },
    ]);
    expect(lines[1]!.unit).toBe(lines[0]!.unit);
    expect(lines[2]!.unit).toBe("kg");
  });
});
