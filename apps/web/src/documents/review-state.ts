import type { LineMatch, ReviewReason } from "@kitchen-ops/shared";

// What the review screen says is left before a document can be posted, and when a line's
// product can be chosen (#118, decisions 0035 and 0036).

/** The reasons as the screen lists them: what has to be done first, the new supplier's note last. */
export const REASON_ORDER = [
  "no_draft",
  "no_supplier",
  "failed_checks",
  "unmapped_lines",
  "unbilled_lines",
  "quantity_differs",
  "new_supplier",
] as const satisfies readonly ReviewReason[];

/** The reasons given, each once, in the screen's order. */
export function orderedReasons(
  reasons: readonly ReviewReason[],
): ReviewReason[] {
  return REASON_ORDER.filter((reason) => reasons.includes(reason));
}

/**
 * Whether a line's product can be chosen now, and if not, why. A line with a supplier product
 * needs nothing. Choosing one remembers it for the document's supplier, so there must be one;
 * and it's the saved line that's remembered (decision 0037), so nothing may be unsaved.
 */
export function mapping(state: {
  hasSupplier: boolean;
  dirty: boolean;
  match: LineMatch | null;
}): { offered: boolean; blocked?: "no_supplier" | "unsaved" } {
  if (state.match !== null && state.match.by !== "suggestion") {
    return { offered: false };
  }
  if (!state.hasSupplier) return { offered: false, blocked: "no_supplier" };
  if (state.dirty) return { offered: false, blocked: "unsaved" };
  return { offered: true };
}
