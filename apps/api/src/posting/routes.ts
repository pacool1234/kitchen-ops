import { randomUUIDv7 } from "node:crypto";
import {
  endpoints,
  mayPost,
  type DocumentMatching,
  type ExtractedDocument,
  type FieldErrorCode,
} from "@kitchen-ops/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext, type Tx } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { documents, products, storerooms } from "../db/schema";
import { readDocument, supplierDocument } from "../documents/read";
import { currentDraft, documentInReview } from "../documents/review";
import { HttpError, notFound } from "../errors";
import { checksOf } from "../extraction/checks";
import { today } from "../extraction/read";
import { readMatching } from "../matching/matching";
import type { Storage } from "../storage/storage";
import {
  postDocument,
  reverseDocument,
  type LineError,
  type PostingResult,
} from "./posting";
import { readPosting } from "./read";
import {
  deliveryNoteToPost,
  invoiceToPost,
  type InvoiceLinePlan,
  type MatchedLine,
} from "./reviewed";
import {
  billedAlready,
  invoiceBilling,
  isCreditNote,
  storedChoices,
} from "../billing/billing";

// Posting a reviewed delivery note, reversing a posted document, and a corrected copy of a
// reversed one to review and post again (#119, decision 0038). Posting works out the document's
// matching again inside its transaction, under the posting lock, so what's posted is the draft
// and the matches as they stand at that moment.

/**
 * The supplier product, pack and product's own storeroom of the lines given (by index), or of
 * every line.
 */
async function matchedLines(
  tx: Tx,
  matching: DocumentMatching,
  only?: (i: number) => boolean,
): Promise<(MatchedLine | null)[]> {
  const offers = matching.lines.map(({ match }, i) => {
    if (only && !only(i)) return null;
    // Posting is refused while such a line is unmapped, so each one has its supplier product.
    if (!match || match.by === "suggestion") throw new Error("unmapped line");
    return match.supplierProduct;
  });
  const wanted = offers.filter((o) => o !== null);
  const productIds = [...new Set(wanted.map((o) => o.product.id))];
  if (productIds.length === 0) return offers.map(() => null);
  const defaults = await tx
    .select({
      id: products.id,
      storeroomId: products.defaultStoreroomId,
    })
    .from(products)
    .where(inArray(products.id, productIds));
  return offers.map((offer) =>
    offer === null
      ? null
      : {
          supplierProductId: offer.id,
          productId: offer.product.id,
          packBaseUnits: offer.packBaseUnits,
          defaultStoreroomId:
            defaults.find((d) => d.id === offer.product.id)?.storeroomId ??
            null,
        },
  );
}

/**
 * 409 already_billed, on each line's field, if a line of this invoice is confirmed for a
 * delivery-note line another invoice that stands bills: one posted since it was chosen. Said
 * before what's left, which the choice no longer counting would otherwise be.
 */
async function refuseBilledMeanwhile(
  tx: Tx,
  id: string,
  draft: ExtractedDocument | null,
) {
  if (draft?.documentType !== "invoice" || isCreditNote(draft)) return;
  const stored = await storedChoices(tx, id);
  const taken = await billedAlready(
    tx,
    stored.flatMap((c) => c.deliveryNoteLineId ?? []),
  );
  const fields: Record<string, FieldErrorCode> = {};
  for (const choice of stored) {
    if (choice.deliveryNoteLineId && taken.has(choice.deliveryNoteLineId)) {
      fields[`lines.${choice.position - 1}`] = "taken";
    }
  }
  if (Object.keys(fields).length > 0) {
    throw new HttpError(409, "already_billed", fields);
  }
}

/** The storerooms chosen, one per line: each must be one of ours, and active. 400 otherwise. */
async function checkStorerooms(
  tx: Tx,
  chosen: readonly (string | null)[],
  lineCount: number,
) {
  if (chosen.length !== lineCount) {
    throw new HttpError(400, "invalid_input", { storerooms: "invalid" });
  }
  const ids = [...new Set(chosen.filter((s) => s !== null))];
  const found =
    ids.length === 0
      ? []
      : await tx
          .select({ id: storerooms.id, active: storerooms.active })
          .from(storerooms)
          .where(inArray(storerooms.id, ids));
  const fields: Record<string, FieldErrorCode> = {};
  chosen.forEach((id, i) => {
    if (id === null) return;
    const storeroom = found.find((s) => s.id === id);
    if (!storeroom) fields[`storerooms.${i}`] = "not_found";
    else if (!storeroom.active) fields[`storerooms.${i}`] = "invalid";
  });
  if (Object.keys(fields).length > 0) {
    throw new HttpError(400, "invalid_input", fields);
  }
}

/**
 * Lines the ledger refused, by their quantity in the draft. Everything else about a line is
 * checked before (reviewed.ts), so what's left is stock: a return would take it below zero
 * (invariant 6).
 */
function refusedLines(
  errors: readonly LineError[],
  draft: ExtractedDocument | null,
): HttpError {
  const fields: Record<string, FieldErrorCode> = {};
  for (const { line } of errors) {
    if (line === undefined) continue;
    const negative = draft?.lines[line - 1]?.quantity?.startsWith("-");
    fields[`lines.${line - 1}.quantity`] = negative ? "below_zero" : "invalid";
  }
  return new HttpError(409, "cannot_post", fields);
}

/** A refusal from the posting service, as the API answers it. */
function refusal(
  result: Exclude<PostingResult, { ok: true }>,
  draft: ExtractedDocument | null,
): HttpError {
  switch (result.reason) {
    case "not_found":
    case "is_reversal":
      return notFound();
    case "not_ready":
      return new HttpError(409, "not_in_review");
    case "lines":
      return refusedLines(result.errors, draft);
    default:
      return new HttpError(409, result.reason);
  }
}

/** A reviewed invoice as posting takes it: each line's plan, worked out in the transaction. */
async function invoiceToPostNow(
  tx: Tx,
  id: string,
  draft: ExtractedDocument,
  supplierId: string,
  matching: DocumentMatching,
  storerooms: readonly (string | null)[],
) {
  const { plans } = await invoiceBilling(tx, {
    documentId: id,
    draft,
    supplierId,
    matches: matching.lines.map((l) => l.match),
  });
  const matched = await matchedLines(
    tx,
    matching,
    (i) => plans[i]!.kind === "received",
  );
  return invoiceToPost({
    draft,
    supplierId,
    plans: plans.map((plan, i): InvoiceLinePlan =>
      plan.kind === "received"
        ? { kind: "received", matched: matched[i]! }
        : plan,
    ),
    storerooms,
  });
}

export const postingRoutes: FastifyPluginAsyncZod<{
  db: Db;
  storage: Storage | null;
}> = async (app, { db, storage }) => {
  app.route({
    ...routeFor(endpoints.postDocument),
    handler: async (request) => {
      const { id } = request.params;
      const role = request.user!.role;
      let draft: ExtractedDocument | null = null;
      const result = await postDocument(
        db,
        auditContext(request),
        id,
        async (tx) => {
          const document = await documentInReview(tx, id);
          await refuseBilledMeanwhile(tx, id, currentDraft(document));
          const matching = (await readMatching(tx, id))!;
          const left = matching.reviewReasons;
          if (left.some((reason) => reason !== "new_supplier")) {
            throw new HttpError(409, "review_pending");
          }
          // Nothing left: it has a draft, and a supplier.
          draft = currentDraft(document)!;
          if (!mayPost(role, left, draft.documentType)) {
            throw new HttpError(403, "forbidden");
          }
          const chosen = request.body.storerooms;
          await checkStorerooms(tx, chosen, draft.lines.length);
          const supplierId = matching.supplier!.id;
          const reviewed =
            draft.documentType === "delivery-note"
              ? deliveryNoteToPost({
                  draft,
                  supplierId,
                  matched: (await matchedLines(tx, matching)).map((m) => m!),
                  storerooms: chosen,
                })
              : await invoiceToPostNow(
                  tx,
                  id,
                  draft,
                  supplierId,
                  matching,
                  chosen,
                );
          if (!reviewed.ok) {
            throw new HttpError(409, "cannot_post", reviewed.fields);
          }
          return reviewed.document;
        },
      );
      if (!result.ok) throw refusal(result, draft);
      return (await readPosting(db, id))!;
    },
  });

  app.route({
    ...routeFor(endpoints.getDocumentPosting),
    handler: async ({ params }) => {
      const found = await readPosting(db, params.id);
      if (found === undefined) throw notFound();
      if (found === null) throw new HttpError(409, "not_posted");
      return found;
    },
  });

  app.route({
    ...routeFor(endpoints.reverseDocument),
    handler: async (request) => {
      const { id } = request.params;
      const result = await reverseDocument(db, auditContext(request), id, {
        date: today(new Date()),
      });
      if (!result.ok) {
        // The ledger refuses taking out goods that were used since: stock would go below zero.
        if (result.reason === "lines") {
          throw new HttpError(409, "cannot_reverse");
        }
        throw refusal(result, null);
      }
      return (await readPosting(db, id))!;
    },
  });

  app.route({
    ...routeFor(endpoints.createDocumentCopy),
    handler: async (request, reply) => {
      if (!storage) throw new HttpError(503, "storage_unavailable");
      const { id } = request.params;
      const copyId = randomUUIDv7();
      await audited(db, auditContext(request), async (tx) => {
        // Locked, so two copies at once can't both be made.
        const [original] = await tx
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.id, id),
              isNull(documents.reverses),
              supplierDocument,
            ),
          )
          .for("update");
        if (!original) throw notFound();
        const [reversal] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.reverses, id));
        if (!reversal) throw new HttpError(409, "not_reversed");
        const [earlier] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.copyOf, id));
        if (earlier) throw new HttpError(409, "already_copied");

        // What was read, and the version that was posted: reviewed again from there.
        const draft = currentDraft(original);
        const checkFailures = draft
          ? await checksOf(tx, {
              documentId: copyId,
              supplierId: original.supplierId,
              draft,
              today: today(new Date()),
            })
          : null;
        const created = {
          status: "ready_for_review" as const,
          type: original.type,
          supplierId: original.supplierId,
          number: original.number,
          date: original.date,
          copyOf: id,
        };
        await tx.insert(documents).values({
          id: copyId,
          ...created,
          draft: original.draft,
          corrected: original.corrected,
          checkFailures,
          uploadedBy: request.user!.id,
        });
        return {
          result: undefined,
          changes: [
            {
              action: "create",
              entityType: "document",
              entityId: copyId,
              documentId: copyId,
              before: null,
              after: created,
            },
          ],
        };
      });
      return reply
        .code(201)
        .send((await readDocument(db, storage, copyId, request.user!.role))!);
    },
  });
};
