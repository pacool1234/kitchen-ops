import { isDeepStrictEqual } from "node:util";
import type { ExtractedDocument, Role } from "@kitchen-ops/shared";

// Who may correct what in review (spec section 6, decision 0037). Everyone receives deliveries
// and confirms their quantities; reviewing invoices, and everything else on a document, is
// office's and the owner's.

/** The document with its lines' quantities blanked: what a counter user may not change. */
function withoutQuantities(document: ExtractedDocument): ExtractedDocument {
  return {
    ...document,
    lines: document.lines.map((line) => ({ ...line, quantity: null })),
  };
}

/**
 * Whether `role` may save `after` over the draft as it stands, `before` (null when nothing was
 * read). Office and owner, always. A counter user, only on a delivery note, and only its lines'
 * quantities: the same lines, in the same order, everything else as it was. Compared as
 * content, so a draft read back from jsonb, its keys in another order, is the same draft.
 */
export function mayCorrect(
  role: Role,
  before: ExtractedDocument | null,
  after: ExtractedDocument,
): boolean {
  if (role !== "counter") return true;
  return (
    before !== null &&
    before.documentType === "delivery-note" &&
    isDeepStrictEqual(withoutQuantities(before), withoutQuantities(after))
  );
}
