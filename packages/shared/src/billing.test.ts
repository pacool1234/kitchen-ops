import { describe, expect, it } from "vitest";
import { BillingCandidates, DocumentBilling, LineBilling } from "./billing";
import { DocumentMatching } from "./matching";

// Which delivery-note line each invoice line bills (#120, decision 0041): what the review
// screen is sent, and what it sends to confirm or change a line's choice.

const ID = (n: number) =>
  `0199a000-0000-7000-8000-${String(n).padStart(12, "0")}`;

const billable = {
  id: ID(1),
  deliveryNote: { id: ID(2), number: "ALB-0001", date: "2026-10-16" },
  position: 1,
  product: { id: ID(3), name: "Tomate pera", baseUnit: "g" },
  quantity: "5",
  unit: "kg",
  baseQuantity: 5000,
  unitCost: "0.001800",
};

describe("DocumentBilling: the body that confirms or changes each line's choice", () => {
  it("one entry per line: the delivery-note line it bills, received with the invoice, or none", () => {
    const body = {
      lines: [{ deliveryNoteLineId: ID(1) }, { received: true }, null],
    };
    expect(DocumentBilling.parse(body)).toEqual(body);
  });

  it("refuses anything else: received false, both at once, an unknown key, a line ID that isn't one", () => {
    for (const entry of [
      { received: false },
      { deliveryNoteLineId: ID(1), received: true },
      { deliveryNoteLineId: ID(1), more: 1 },
      { deliveryNoteLineId: "line 1" },
    ]) {
      expect(DocumentBilling.safeParse({ lines: [entry] }).success).toBe(false);
    }
    expect(DocumentBilling.safeParse({}).success).toBe(false);
  });
});

describe("LineBilling: an invoice line's choice, as the matching answer gives it", () => {
  it("a delivery-note line, confirmed or only suggested, with its price now, the invoice's and the difference", () => {
    const billed = {
      by: "suggested",
      deliveryNoteLine: billable,
      invoiceUnitCost: "0.001900",
      difference: "0.50",
      quantityMatches: true,
    };
    expect(LineBilling.parse(billed)).toEqual(billed);
    expect(LineBilling.parse({ ...billed, by: "confirmed" }).by).toBe(
      "confirmed",
    );
  });

  it("a price or a difference that can't be worked out is null", () => {
    expect(
      LineBilling.safeParse({
        by: "confirmed",
        deliveryNoteLine: billable,
        invoiceUnitCost: null,
        difference: null,
        quantityMatches: false,
      }).success,
    ).toBe(true);
  });

  it("received with the invoice", () => {
    expect(LineBilling.parse({ by: "received" })).toEqual({ by: "received" });
  });
});

describe("DocumentMatching: an invoice's lines say what they bill, and the document its total difference", () => {
  it("a delivery note's lines bill nothing, and it has no difference", () => {
    const matching = {
      supplier: null,
      newSupplier: false,
      lines: [{ line: 1, match: null, billing: null }],
      difference: null,
      reviewReasons: ["no_supplier"],
    };
    expect(DocumentMatching.parse(matching)).toEqual(matching);
  });

  it("the new reasons: a line not yet billed or received, and a quantity that isn't what was delivered", () => {
    for (const reason of ["unbilled_lines", "quantity_differs"]) {
      expect(
        DocumentMatching.safeParse({
          supplier: null,
          newSupplier: false,
          lines: [],
          difference: "0.00",
          reviewReasons: [reason],
        }).success,
      ).toBe(true);
    }
  });
});

describe("BillingCandidates: the delivery-note lines an invoice may bill", () => {
  it("each with its delivery note, and whether another line of this invoice has it", () => {
    const candidates = { lines: [{ ...billable, chosenFor: 2 }] };
    expect(BillingCandidates.parse(candidates)).toEqual(candidates);
    expect(
      BillingCandidates.parse({ lines: [{ ...billable, chosenFor: null }] }),
    ).toBeTruthy();
  });
});
