import {
  endpoints,
  fieldErrors,
  NewSupplierProduct,
} from "@kitchen-ops/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext, type Tx } from "../audit/audited";
import { createSupplierProduct } from "../catalogue/supplier-products";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { documents, suppliers } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { mappingRefusal } from "./match";
import { offersOf, readMatching } from "./matching";

// Matching a document to the catalogue (#117, decision 0035): its matching, read by everyone;
// choosing its supplier, and remembering one of its lines as a supplier product, by office and
// owner, while it's in review. Both writes are audited with the document.

/** A line's code and description, checked as a supplier product's are. */
const LineNaming = NewSupplierProduct.pick({ code: true, description: true });

/**
 * The document, locked until the transaction ends, so a supplier chosen and a line remembered
 * at the same moment can't cross. 404 if there's none (a reversal is none), 409 if it isn't in
 * review.
 */
async function documentInReview(tx: Tx, id: string) {
  const [document] = await tx
    .select({
      status: documents.status,
      supplierId: documents.supplierId,
      draft: documents.draft,
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

export const matchingRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.getDocumentMatching),
    handler: async ({ params }) => {
      const found = await readMatching(db, params.id);
      if (!found) throw notFound();
      return found;
    },
  });

  app.route({
    ...routeFor(endpoints.setDocumentSupplier),
    handler: async (request) => {
      const { id } = request.params;
      const { supplierId } = request.body;
      await audited(db, auditContext(request), async (tx) => {
        const before = await documentInReview(tx, id);
        const [supplier] = await tx
          .select({ active: suppliers.active })
          .from(suppliers)
          .where(eq(suppliers.id, supplierId));
        if (!supplier) {
          throw new HttpError(400, "invalid_input", {
            supplierId: "not_found",
          });
        }
        if (!supplier.active) {
          throw new HttpError(400, "invalid_input", { supplierId: "invalid" });
        }
        await tx
          .update(documents)
          .set({ supplierId })
          .where(eq(documents.id, id));
        return {
          result: undefined,
          changes: [
            {
              action: "update",
              entityType: "document",
              entityId: id,
              documentId: id,
              before: { supplierId: before.supplierId },
              after: { supplierId },
            },
          ],
        };
      });
      return (await readMatching(db, id))!;
    },
  });

  app.route({
    ...routeFor(endpoints.createLineMapping),
    handler: async (request, reply) => {
      const { id, line: position } = request.params;
      const { productId, pack } = request.body;
      await audited(db, auditContext(request), async (tx) => {
        const document = await documentInReview(tx, id);
        const line = document.draft?.lines[position - 1];
        if (!line) throw notFound();
        if (!document.supplierId) throw new HttpError(409, "no_supplier");
        const supplierId = document.supplierId;
        // The supplier's row, so two lines remembered for it at once are checked one by one:
        // a description without a code has no unique index to catch the second.
        await tx
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(eq(suppliers.id, supplierId))
          .for("no key update");

        // A description not read is a blank one: refused as required.
        const naming = {
          code: line.supplierCode,
          description: line.description ?? "",
        };
        const named = LineNaming.safeParse(naming);
        if (!named.success) {
          throw new HttpError(
            409,
            "conflict",
            fieldErrors(named.error.issues, naming),
          );
        }
        const refused = mappingRefusal(line, await offersOf(tx, supplierId));
        if (refused) throw new HttpError(409, "conflict", refused);

        return createSupplierProduct(
          tx,
          { supplierId, ...named.data, productId, pack },
          id,
        );
      });
      return reply.code(201).send((await readMatching(db, id))!);
    },
  });
};
