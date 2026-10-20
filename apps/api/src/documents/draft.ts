import { endpoints } from "@kitchen-ops/shared";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { documents } from "../db/schema";
import { HttpError } from "../errors";
import {
  checksOf,
  supplierByTaxId,
  withoutMessages,
} from "../extraction/checks";
import { today } from "../extraction/read";
import { mayCorrect } from "./corrections";
import { currentDraft, documentInReview } from "./review";

// Correcting a document's draft in review (#118, decision 0037). A correction is saved whole,
// apart from what the model read, and checked again as the reading job checks a draft; a
// version can also be checked without saving it, as it's typed. A counter user may change only
// a delivery note's quantities (corrections.ts).

export const draftRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.saveDocumentDraft),
    handler: async (request) => {
      const { id } = request.params;
      const corrected = request.body;
      return audited(db, auditContext(request), async (tx) => {
        const before = await documentInReview(tx, id);
        if (!mayCorrect(request.user!.role, currentDraft(before), corrected)) {
          throw new HttpError(403, "forbidden");
        }
        // A supplier it has stays, chosen or found when it was read; without one, the tax ID
        // corrected may find it.
        const supplierId =
          before.supplierId ??
          (await supplierByTaxId(tx, corrected.supplier.taxId));
        const failures = await checksOf(tx, {
          documentId: id,
          supplierId,
          draft: corrected,
          today: today(new Date()),
        });
        // Its header is the corrected one: the list shows it.
        const after = {
          corrected,
          supplierId,
          type: corrected.documentType,
          number: corrected.number,
          date: corrected.issueDate,
        };
        await tx
          .update(documents)
          .set({ ...after, checkFailures: failures })
          .where(eq(documents.id, id));
        return {
          result: { corrected, checkFailures: withoutMessages(failures) },
          changes: [
            {
              action: "update",
              entityType: "document",
              entityId: id,
              documentId: id,
              before: {
                corrected: before.corrected,
                supplierId: before.supplierId,
                type: before.type,
                number: before.number,
                date: before.date,
              },
              after,
            },
          ],
        };
      });
    },
  });

  app.route({
    ...routeFor(endpoints.checkDocumentDraft),
    handler: async (request) => {
      const { id } = request.params;
      // In a transaction only to read the document as save does: nothing is written.
      return db.transaction(async (tx) => {
        const document = await documentInReview(tx, id);
        const failures = await checksOf(tx, {
          documentId: id,
          supplierId: document.supplierId,
          draft: request.body,
          today: today(new Date()),
        });
        return { checkFailures: withoutMessages(failures) };
      });
    },
  });
};
