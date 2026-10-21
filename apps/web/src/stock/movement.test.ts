import { describe, expect, it } from "vitest";
import { movementDocument, signedQuantity } from "./movement";

// A movement on a product's stock page (#150): the document it came from, and its quantity.

const NBSP = String.fromCharCode(0xa0);
const NOTE = "0199a000-0000-7000-8000-000000000001";
const REVERSAL = "0199a000-0000-7000-8000-000000000002";

describe("movementDocument", () => {
  it("a delivery note links to its own page", () => {
    expect(
      movementDocument({
        id: NOTE,
        type: "delivery-note",
        number: "A-1",
        reverses: null,
      }),
    ).toEqual({
      type: "delivery-note",
      number: "A-1",
      reversal: false,
      pageId: NOTE,
    });
  });

  it("a reversal links to the page of the document it reverses, which shows both", () => {
    expect(
      movementDocument({
        id: REVERSAL,
        type: "invoice",
        number: "F-7",
        reverses: NOTE,
      }),
    ).toEqual({ type: "invoice", number: "F-7", reversal: true, pageId: NOTE });
  });

  it("waste, a count or a transfer has no page to link to yet, reversed or not", () => {
    for (const type of ["waste", "count", "transfer"] as const) {
      expect(
        movementDocument({ id: NOTE, type, number: null, reverses: null }),
      ).toEqual({ type, number: null, reversal: false, pageId: null });
      expect(
        movementDocument({ id: REVERSAL, type, number: null, reverses: NOTE }),
      ).toEqual({ type, number: null, reversal: true, pageId: null });
    }
  });
});

describe("signedQuantity", () => {
  it("in and out of the storeroom, as a kitchen says it: +5 kg, -4 kg, -250 ml", () => {
    expect(signedQuantity(5000, "g", "es")).toBe(`+5${NBSP}kg`);
    expect(signedQuantity(-4000, "g", "es")).toBe(`-4${NBSP}kg`);
    expect(signedQuantity(-250, "ml", "es")).toBe(`-250${NBSP}ml`);
    expect(signedQuantity(2500, "unit", "en")).toBe(`+2.5${NBSP}units`);
  });

  it("a count that matched the stock moved nothing: 0, without a sign", () => {
    expect(signedQuantity(0, "g", "es")).toBe(`0${NBSP}g`);
  });
});
