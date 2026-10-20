import type { ExtractedDocument } from "@kitchen-ops/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "../audit/audited";
import { documents } from "../db/schema";
import { HttpError, notFound } from "../errors";

// A document in review (M7): what's read and changed while it is, by its matching (#117) and
// its corrections (#118).

/** The draft as it stands: as corrected in review, or else as read (decision 0037). */
export const currentDraft = (document: {
  draft: ExtractedDocument | null;
  corrected: ExtractedDocument | null;
}): ExtractedDocument | null => document.corrected ?? document.draft;

/**
 * The document, locked until the transaction ends, so two changes to it at the same moment
 * can't cross. 404 if there's none (a reversal is none), 409 if it isn't in review.
 */
export async function documentInReview(tx: Tx, id: string) {
  const [document] = await tx
    .select({
      status: documents.status,
      type: documents.type,
      supplierId: documents.supplierId,
      number: documents.number,
      date: documents.date,
      draft: documents.draft,
      corrected: documents.corrected,
    })
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.reverses)))
    .for("update");
  if (!document) throw notFound();
  if (document.status !== "ready_for_review") {
    throw new HttpError(409, "not_in_review");
  }
  return document;
}
