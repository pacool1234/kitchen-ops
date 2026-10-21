import {
  EXTRACTED_DOCUMENT_TYPES,
  mayPost,
  REVIEW_REASONS,
  ROLES,
} from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { en } from "../i18n/messages/en";
import { es } from "../i18n/messages/es";
import { POST_BLOCKS, posting, startingStoreroom } from "./posting-state";

// When the review screen offers to post a document, and why not when it doesn't (#119,
// decision 0038); and which storeroom a line starts on.

const state = fc.record({
  role: fc.constantFrom(...ROLES),
  reasons: fc.uniqueArray(fc.constantFrom(...REVIEW_REASONS)),
  dirty: fc.boolean(),
  type: fc.constantFrom(null, ...EXTRACTED_DOCUMENT_TYPES),
});

describe("posting: whether the screen offers to post the document", () => {
  it("is offered exactly when the role may post with what's left, nothing is unsaved, and it's a delivery note; otherwise it says one reason", () => {
    fc.assert(
      fc.property(state, (s) => {
        const offered =
          s.type === "delivery-note" &&
          mayPost(s.role, s.reasons, s.type) &&
          !s.dirty;
        const shown = posting(s);
        expect(shown.offered).toBe(offered);
        if (offered) expect(shown.blocked).toBeUndefined();
        else expect(POST_BLOCKS).toContain(shown.blocked);
      }),
    );
  });

  it("says first what's left to do, then that invoices wait, then the new supplier, then the unsaved corrections", () => {
    const pending = { role: "office", dirty: true, type: "invoice" } as const;
    expect(posting({ ...pending, reasons: ["unmapped_lines"] }).blocked).toBe(
      "pending",
    );
    expect(posting({ ...pending, reasons: [] }).blocked).toBe("invoice");
    expect(
      posting({
        role: "counter",
        reasons: ["new_supplier"],
        dirty: true,
        type: "delivery-note",
      }).blocked,
    ).toBe("new_supplier");
    expect(
      posting({
        role: "office",
        reasons: ["new_supplier"],
        dirty: true,
        type: "delivery-note",
      }).blocked,
    ).toBe("unsaved");
  });

  it("a document nothing was read of waits for what's left", () => {
    expect(
      posting({
        role: "owner",
        reasons: ["no_draft"],
        dirty: false,
        type: null,
      }),
    ).toEqual({ offered: false, blocked: "pending" });
  });

  it("every reason has its words in Spanish and in English", () => {
    for (const block of POST_BLOCKS) {
      expect(es.documents.posting.blocked[block]).toBeTruthy();
      expect(en.documents.posting.blocked[block]).toBeTruthy();
    }
  });
});

describe("startingStoreroom: where a line is received unless another is chosen", () => {
  const COLD = "0199a000-0000-7000-8000-000000000001";
  const BAR = "0199a000-0000-7000-8000-000000000002";
  const active = [{ id: COLD }, { id: BAR }];

  it("its product's own storeroom", () => {
    expect(startingStoreroom(COLD, active)).toBe(COLD);
  });

  it("none, to be chosen, when the product has none, or its own is no longer active", () => {
    expect(startingStoreroom(null, active)).toBe("");
    expect(startingStoreroom(COLD, [{ id: BAR }])).toBe("");
  });
});
