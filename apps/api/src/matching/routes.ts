import {
  endpoints,
  fieldErrors,
  NewSupplierProduct,
} from "@kitchen-ops/shared";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext } from "../audit/audited";
import { createSupplierProduct } from "../catalogue/supplier-products";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { documents, suppliers } from "../db/schema";
import { currentDraft, documentInReview } from "../documents/review";
import { HttpError, notFound } from "../errors";
import { checksOf } from "../extraction/checks";
import { today } from "../extraction/read";
import { mappingRefusal } from "./match";
import { offersOf, readMatching } from "./matching";

// Matching a document to the catalogue (#117, decision 0035): its matching, read by everyone;
// choosing its supplier, and remembering one of its lines as a supplier product, by office and
// owner, while it's in review. Both writes are audited with the document. Both read the draft
// as it stands, corrected or as read (#118), and a supplier chosen has it checked again.

/** A line's code and description, checked as a supplier product's are. */
const LineNaming = NewSupplierProduct.pick({ code: true, description: true });

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
        // The duplicate check compares the number with this supplier's: run them all again.
        const draft = currentDraft(before);
        const checkFailures = draft
          ? await checksOf(tx, {
              documentId: id,
              supplierId,
              draft,
              today: today(new Date()),
            })
          : null;
        await tx
          .update(documents)
          .set({ supplierId, checkFailures })
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
        const line = currentDraft(document)?.lines[position - 1];
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
