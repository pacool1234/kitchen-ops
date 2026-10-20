import {
  REVIEW_REASONS,
  type LineMatch,
  type ReviewReason,
} from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { en } from "../i18n/messages/en";
import { es } from "../i18n/messages/es";
import { mapping, orderedReasons, REASON_ORDER } from "./review-state";

// What the review screen says is left before posting, and when a line's product can be chosen
// (#118, decisions 0035 and 0036).

const supplierProduct = {
  id: "0199a000-0000-7000-8000-000000000001",
  supplier: { id: "0199a000-0000-7000-8000-000000000002", name: "Huerto" },
  code: "T-01",
  description: "Tomate pera",
  product: {
    id: "0199a000-0000-7000-8000-000000000003",
    name: "Tomate pera",
    baseUnit: "g" as const,
  },
  pack: { quantity: "1", unit: "kg" },
  packBaseUnits: 1000,
  active: true,
};
const suggestion: LineMatch = {
  by: "suggestion",
  product: supplierProduct.product,
};
const match = fc.constantFrom<LineMatch | null>(
  null,
  suggestion,
  { by: "code", supplierProduct } as LineMatch,
  { by: "description", supplierProduct } as LineMatch,
);

describe("choosing a line's product", () => {
  it("is offered exactly when the document has a supplier, nothing is unsaved, and the line has no supplier product yet", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        match,
        (hasSupplier, dirty, m) => {
          const matched = m !== null && m.by !== "suggestion";
          expect(mapping({ hasSupplier, dirty, match: m }).offered).toBe(
            hasSupplier && !dirty && !matched,
          );
        },
      ),
    );
  });

  it("when it isn't offered for a line still to map, it says why: the supplier first, then unsaved corrections", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        match,
        (hasSupplier, dirty, m) => {
          const matched = m !== null && m.by !== "suggestion";
          const { blocked } = mapping({ hasSupplier, dirty, match: m });
          expect(blocked).toBe(
            matched
              ? undefined
              : !hasSupplier
                ? "no_supplier"
                : dirty
                  ? "unsaved"
                  : undefined,
          );
        },
      ),
    );
  });
});

describe("what's left before posting", () => {
  it("any reasons, in one fixed order, each once", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...REVIEW_REASONS)),
        (reasons: ReviewReason[]) => {
          const ordered = orderedReasons(reasons);
          expect(new Set(ordered)).toEqual(new Set(reasons));
          expect(ordered).toHaveLength(new Set(reasons).size);
          expect(ordered).toEqual(
            REASON_ORDER.filter((r) => reasons.includes(r)),
          );
        },
      ),
    );
  });

  it("the order has every reason: what has to be done before the new supplier's note", () => {
    expect([...REASON_ORDER].sort()).toEqual([...REVIEW_REASONS].sort());
    expect(REASON_ORDER.at(-1)).toBe("new_supplier");
  });

  it("each reason has its words, in Spanish and in English", () => {
    for (const reason of REVIEW_REASONS) {
      expect(es.documents.reasons[reason], reason).toMatch(/\S/);
      expect(en.documents.reasons[reason], reason).toMatch(/\S/);
    }
  });
});
