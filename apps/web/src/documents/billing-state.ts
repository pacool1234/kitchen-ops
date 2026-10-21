import type {
  DocumentBilling,
  LineBilling,
  LineBillingChoice,
} from "@kitchen-ops/shared";

// What an invoice's line bills, in review (#120, decision 0041): what each line offers, and the
// choices sent when one line's changes. `PUT …/billing` takes every line's choice at once, so a
// change to one sends the others as they're stored.

/**
 * What a line's billing is sent as: a confirmed line, its delivery-note line; one received with
 * the invoice, so; a suggestion or nothing, null. A suggestion is never stored until confirmed.
 */
export function storedChoice(billing: LineBilling | null): LineBillingChoice {
  if (billing?.by === "confirmed") {
    return { deliveryNoteLineId: billing.deliveryNoteLine.id };
  }
  if (billing?.by === "received") return { received: true };
  return null;
}

/**
 * Every line's choice, with line `index` changed to `choice`. A delivery-note line bills one
 * invoice line only: chosen for this one, it leaves the line it was confirmed for undecided.
 */
export function billingWith(
  lines: readonly (LineBilling | null)[],
  index: number,
  choice: LineBillingChoice,
): DocumentBilling {
  const taken =
    choice !== null && "deliveryNoteLineId" in choice
      ? choice.deliveryNoteLineId
      : undefined;
  return {
    lines: lines.map((billing, i) => {
      if (i === index) return choice;
      const stored = storedChoice(billing);
      return stored !== null &&
        "deliveryNoteLineId" in stored &&
        stored.deliveryNoteLineId === taken
        ? null
        : stored;
    }),
  };
}

/** Why a line's choice can't be made now, in the order the screen says them. */
export const BILLING_BLOCKS = [
  /** The candidates are the supplier's delivery notes: it needs one. */
  "no_supplier",
  /** Corrections not saved: the choices are for the saved lines. */
  "unsaved",
] as const;
export type BillingBlock = (typeof BILLING_BLOCKS)[number];

/**
 * What a line offers: to confirm its suggestion, choose a delivery-note line (another, or one at
 * all), or receive it with the invoice. Nothing for a role that may not choose, which needs no
 * reason: it isn't theirs to do.
 */
export function billingOffers(state: {
  mayChoose: boolean;
  hasSupplier: boolean;
  dirty: boolean;
  billing: LineBilling | null;
}): {
  confirm: boolean;
  choose: boolean;
  receive: boolean;
  blocked?: BillingBlock;
} {
  const none = { confirm: false, choose: false, receive: false };
  if (!state.mayChoose) return none;
  if (!state.hasSupplier) return { ...none, blocked: "no_supplier" };
  if (state.dirty) return { ...none, blocked: "unsaved" };
  return {
    confirm: state.billing?.by === "suggested",
    choose: true,
    receive: state.billing?.by !== "received",
  };
}

/**
 * Whether a line goes into a storeroom when posted: every line of a delivery note; of an
 * invoice, only one received with it. A line it bills stays where its delivery note put it.
 */
export function receivesStock(
  invoice: boolean,
  billing: LineBilling | null,
): boolean {
  return !invoice || billing?.by === "received";
}
