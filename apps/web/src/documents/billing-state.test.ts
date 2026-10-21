import type {
  BillableLine,
  LineBilling,
  LineBillingChoice,
} from "@kitchen-ops/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { en } from "../i18n/messages/en";
import { es } from "../i18n/messages/es";
import {
  BILLING_BLOCKS,
  billingOffers,
  billingWith,
  receivesStock,
  storedChoice,
} from "./billing-state";

// What an invoice's line bills, in review (#120, decision 0041): what each line offers, and the
// choices sent when one line's changes.

const IDS = [
  "0199a000-0000-7000-8000-000000000001",
  "0199a000-0000-7000-8000-000000000002",
  "0199a000-0000-7000-8000-000000000003",
] as const;

const noteLine = (id: string): BillableLine => ({
  id,
  deliveryNote: {
    id: "0199a000-0000-7000-8000-0000000000aa",
    number: "ALB-0001",
    date: "2026-10-21",
  },
  position: 1,
  product: {
    id: "0199a000-0000-7000-8000-0000000000bb",
    name: "Tomate pera",
    baseUnit: "g",
  },
  quantity: "5",
  unit: "kg",
  baseQuantity: 5000,
  unitCost: "0.001800",
});
const billed = (by: "confirmed" | "suggested", id: string): LineBilling => ({
  by,
  deliveryNoteLine: noteLine(id),
  invoiceUnitCost: "0.002000",
  difference: "1.00",
  quantityMatches: true,
});
const received: LineBilling = { by: "received" };

const id = fc.constantFrom(...IDS);
const lineBilling = fc.oneof(
  fc.constant(null),
  fc.constant(received),
  id.map((i) => billed("suggested", i)),
  id.map((i) => billed("confirmed", i)),
);
/** An invoice's lines as the API answers them: no delivery-note line confirmed for two. */
const lines = fc
  .array(lineBilling, { minLength: 1, maxLength: 5 })
  .filter((all) => {
    const confirmed = all.flatMap((b) =>
      b?.by === "confirmed" ? [b.deliveryNoteLine.id] : [],
    );
    return new Set(confirmed).size === confirmed.length;
  });
const choice = fc.oneof(
  fc.constant<LineBillingChoice>(null),
  fc.constant<LineBillingChoice>({ received: true }),
  id.map<LineBillingChoice>((i) => ({ deliveryNoteLineId: i })),
);

describe("storedChoice: what a line's billing is sent as", () => {
  it("a confirmed line, its delivery-note line; one received with the invoice, so; a suggestion or nothing, null: a suggestion is never stored", () => {
    expect(storedChoice(billed("confirmed", IDS[0]))).toEqual({
      deliveryNoteLineId: IDS[0],
    });
    expect(storedChoice(received)).toEqual({ received: true });
    expect(storedChoice(billed("suggested", IDS[0]))).toBeNull();
    expect(storedChoice(null)).toBeNull();
  });
});

describe("billingWith: the choices sent when one line's changes", () => {
  it("for any lines and any change: one choice per line, the changed line's as chosen, every other line's as stored, except one that gives up the delivery-note line chosen; never one delivery-note line for two", () => {
    fc.assert(
      fc.property(lines, fc.nat(), choice, (all, n, chosen) => {
        const index = n % all.length;
        const sent = billingWith(all, index, chosen);
        expect(sent.lines).toHaveLength(all.length);
        expect(sent.lines[index]).toEqual(chosen);
        all.forEach((line, j) => {
          if (j === index) return;
          const givesUp =
            chosen !== null &&
            "deliveryNoteLineId" in chosen &&
            line?.by === "confirmed" &&
            line.deliveryNoteLine.id === chosen.deliveryNoteLineId;
          expect(sent.lines[j]).toEqual(givesUp ? null : storedChoice(line));
        });
        const ids = sent.lines.flatMap((c) =>
          c !== null && "deliveryNoteLineId" in c ? [c.deliveryNoteLineId] : [],
        );
        expect(new Set(ids).size).toBe(ids.length);
      }),
    );
  });

  it("confirming line 2's suggestion keeps line 1's confirmed choice, and sends line 3's suggestion as nothing", () => {
    const all = [
      billed("confirmed", IDS[0]),
      billed("suggested", IDS[1]),
      billed("suggested", IDS[2]),
    ];
    expect(billingWith(all, 1, { deliveryNoteLineId: IDS[1] })).toEqual({
      lines: [
        { deliveryNoteLineId: IDS[0] },
        { deliveryNoteLineId: IDS[1] },
        null,
      ],
    });
  });

  it("choosing for line 2 the delivery-note line line 1 had moves it: line 1 is left undecided", () => {
    const all = [billed("confirmed", IDS[0]), received];
    expect(billingWith(all, 1, { deliveryNoteLineId: IDS[0] })).toEqual({
      lines: [null, { deliveryNoteLineId: IDS[0] }],
    });
  });
});

describe("billingOffers: what a line offers, and why not", () => {
  const ready = { mayChoose: true, hasSupplier: true, dirty: false };

  it("a suggestion: to confirm it, choose another, or receive the line with the invoice", () => {
    expect(
      billingOffers({ ...ready, billing: billed("suggested", IDS[0]) }),
    ).toEqual({ confirm: true, choose: true, receive: true });
  });

  it("a confirmed line or an undecided one: to choose another, or receive it", () => {
    for (const billing of [billed("confirmed", IDS[0]), null]) {
      expect(billingOffers({ ...ready, billing })).toEqual({
        confirm: false,
        choose: true,
        receive: true,
      });
    }
  });

  it("a line received with the invoice: to choose a delivery-note line instead", () => {
    expect(billingOffers({ ...ready, billing: received })).toEqual({
      confirm: false,
      choose: true,
      receive: false,
    });
  });

  it("nothing for a role that may not choose (counter staff), and nothing said why: it's not theirs to do", () => {
    expect(
      billingOffers({
        ...ready,
        mayChoose: false,
        billing: billed("suggested", IDS[0]),
      }),
    ).toEqual({ confirm: false, choose: false, receive: false });
  });

  it("waits for the supplier, then for the corrections to be saved: the choices are for the saved lines", () => {
    const billing = billed("suggested", IDS[0]);
    const none = { confirm: false, choose: false, receive: false };
    expect(
      billingOffers({ ...ready, hasSupplier: false, dirty: true, billing }),
    ).toEqual({ ...none, blocked: "no_supplier" });
    expect(billingOffers({ ...ready, dirty: true, billing })).toEqual({
      ...none,
      blocked: "unsaved",
    });
  });

  it("every reason has its words in Spanish and in English", () => {
    for (const block of BILLING_BLOCKS) {
      expect(es.documents.billing.blocked[block]).toBeTruthy();
      expect(en.documents.billing.blocked[block]).toBeTruthy();
    }
  });
});

describe("receivesStock: whether a line goes into a storeroom when posted", () => {
  it("every line of a delivery note; of an invoice, only a line received with it: a line it bills stays where its delivery note put it", () => {
    fc.assert(
      fc.property(lineBilling, (billing) => {
        expect(receivesStock(false, billing)).toBe(true);
        expect(receivesStock(true, billing)).toBe(billing?.by === "received");
      }),
    );
  });
});
