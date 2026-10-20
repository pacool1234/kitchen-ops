import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ROLES } from "./auth";
import { REVIEW_REASONS } from "./matching";
import { DocumentPosting, mayPost, PostDocument } from "./posting";

// Posting a reviewed delivery note, and reversing a posted document (#119, decision 0038): who
// may post one, and what the screens are sent and send.

const reasons = fc.uniqueArray(fc.constantFrom(...REVIEW_REASONS));

describe("mayPost: who may post a delivery note, by what's left before posting it", () => {
  it("a counter user may post exactly when nothing is left; office and owner exactly when nothing but a new supplier is left", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ROLES), reasons, (role, left) => {
        const onlyNewSupplier = left.every((r) => r === "new_supplier");
        const expected =
          role === "counter" ? left.length === 0 : onlyNewSupplier;
        expect(mayPost(role, left)).toBe(expected);
      }),
    );
  });

  it("examples: a new supplier's document waits for the office", () => {
    expect(mayPost("counter", [])).toBe(true);
    expect(mayPost("counter", ["new_supplier"])).toBe(false);
    expect(mayPost("office", ["new_supplier"])).toBe(true);
    expect(mayPost("owner", ["new_supplier", "unmapped_lines"])).toBe(false);
  });
});

describe("PostDocument: the body of posting one", () => {
  it("takes a storeroom, or null for the product's default, for each line", () => {
    const body = {
      storerooms: ["0199a000-0000-7000-8000-000000000001", null],
    };
    expect(PostDocument.parse(body)).toEqual(body);
  });

  it("refuses anything else", () => {
    expect(PostDocument.safeParse({ storerooms: ["cold room"] }).success).toBe(
      false,
    );
    expect(PostDocument.safeParse({}).success).toBe(false);
    expect(PostDocument.safeParse({ storerooms: [], more: true }).success).toBe(
      false,
    );
  });
});

describe("DocumentPosting: a posted document's lines and movements", () => {
  const storeroom = {
    id: "0199a000-0000-7000-8000-000000000003",
    name: "Cámara",
  };
  const line = {
    position: 1,
    product: {
      id: "0199a000-0000-7000-8000-000000000004",
      name: "Tomate pera",
      baseUnit: "g",
    },
    quantity: "1.5",
    unit: "caja",
    unitPrice: "12.000000",
    discountPercent: null,
    vatRate: "10.00",
    storeroom,
    movements: [
      {
        id: "0199a000-0000-7000-8000-000000000005",
        storeroom,
        quantity: 9000,
        unitCost: "0.002000",
        kind: "receipt",
        reverses: null,
        corrects: null,
      },
    ],
  };

  it("parses a posted delivery note, and one reversed", () => {
    const posted = { lines: [line], reversal: null };
    expect(DocumentPosting.parse(posted)).toEqual(posted);
    const reversed = {
      lines: [line],
      reversal: {
        id: "0199a000-0000-7000-8000-000000000006",
        date: "2026-10-21",
        reversedBy: { id: "0199a000-0000-7000-8000-000000000007", name: "Eva" },
        lines: [line],
      },
    };
    expect(DocumentPosting.parse(reversed)).toEqual(reversed);
  });
});
