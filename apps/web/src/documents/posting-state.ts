import {
  mayPost,
  type DocumentType,
  type ReviewReason,
  type Role,
} from "@kitchen-ops/shared";

// Whether the review screen offers to post a document, and why not when it doesn't (#119,
// decision 0038); and which storeroom a line starts on.

/** Why "Registrar el albarán" can't be used now, in the order the screen says them. */
export const POST_BLOCKS = [
  /** Something other than a new supplier is left: listed above it. */
  "pending",
  /** Invoices are posted later (#120). */
  "invoice",
  /** A counter user, and a new supplier: office or owner reviews and posts it. */
  "new_supplier",
  /** Corrections not saved: what's posted is the saved draft. */
  "unsaved",
] as const;
export type PostBlock = (typeof POST_BLOCKS)[number];

/**
 * Posting is offered when the role may post with what's left (`mayPost`, as the API decides),
 * nothing is unsaved, and the draft on screen is a delivery note; otherwise the first reason.
 */
export function posting(state: {
  role: Role;
  reasons: readonly ReviewReason[];
  dirty: boolean;
  /** The draft's type, as on screen; null when nothing was read. */
  type: DocumentType | null;
}): { offered: boolean; blocked?: PostBlock } {
  const { role, reasons, dirty, type } = state;
  if (reasons.some((r) => r !== "new_supplier") || type === null) {
    return { offered: false, blocked: "pending" };
  }
  if (type !== "delivery-note") return { offered: false, blocked: "invoice" };
  if (!mayPost(role, reasons)) {
    return { offered: false, blocked: "new_supplier" };
  }
  if (dirty) return { offered: false, blocked: "unsaved" };
  return { offered: true };
}

/**
 * Where a line starts on: its product's own storeroom while it's active, or "" to choose one.
 * Posting sends it as chosen, so the API never falls back to a storeroom the screen didn't show.
 */
export function startingStoreroom(
  own: string | null,
  active: readonly { id: string }[],
): string {
  return own !== null && active.some((s) => s.id === own) ? own : "";
}
