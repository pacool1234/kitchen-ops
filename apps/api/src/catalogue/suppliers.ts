import {
  endpoints,
  normalizeTaxId,
  type SupplierPage,
} from "@kitchen-ops/shared";
import { and, count, eq, or } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { suppliers } from "../db/schema";
import { notFound } from "../errors";
import { contains, pageWindow, spanishOrder, withStatus } from "./lists";

// Suppliers (#88): who the restaurant buys from. Their tax ID arrives checked and normalized
// (`TaxId` in packages/shared), and a unique index refuses a second supplier with the same one.
// Everyone signed in reads them; office and owner change them. Every change is audited.

/** A supplier as the API answers it (`Supplier` in packages/shared). */
const supplier = {
  id: suppliers.id,
  name: suppliers.name,
  taxId: suppliers.taxId,
  contactName: suppliers.contactName,
  email: suppliers.email,
  phone: suppliers.phone,
  active: suppliers.active,
};

/** Suppliers whose name has the text, or whose tax ID has it however it's typed ("b-00.12"). */
function matchingText(q: string) {
  const taxId = normalizeTaxId(q);
  return or(
    contains(suppliers.name, q),
    // Only separators ("-") leave nothing to look for in a tax ID.
    taxId ? contains(suppliers.taxId, taxId) : undefined,
  );
}

export const supplierRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.listSuppliers),
    handler: async ({ query }): Promise<SupplierPage> => {
      const matching = and(
        query.q ? matchingText(query.q) : undefined,
        withStatus(suppliers.active, query.status),
      );
      const { limit, offset } = pageWindow(query);
      const [items, [counted]] = await Promise.all([
        db
          .select(supplier)
          .from(suppliers)
          .where(matching)
          .orderBy(spanishOrder(suppliers.name), suppliers.id)
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(suppliers).where(matching),
      ]);
      return {
        items,
        total: counted?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  });

  app.route({
    ...routeFor(endpoints.getSupplier),
    handler: async ({ params }) => {
      const [found] = await db
        .select(supplier)
        .from(suppliers)
        .where(eq(suppliers.id, params.id));
      if (!found) throw notFound();
      return found;
    },
  });

  app.route({
    ...routeFor(endpoints.createSupplier),
    handler: async (request, reply) => {
      const created = await audited(db, auditContext(request), async (tx) => {
        const [row] = await tx
          .insert(suppliers)
          .values(request.body)
          .returning(supplier);
        return {
          result: row!,
          changes: [
            {
              action: "create",
              entityType: "supplier",
              entityId: row!.id,
              before: null,
              after: row!,
            },
          ],
        };
      });
      return reply.code(201).send(created);
    },
  });

  app.route({
    ...routeFor(endpoints.updateSupplier),
    handler: async (request) => {
      const { id } = request.params;
      const changes = request.body;
      return audited(db, auditContext(request), async (tx) => {
        // Locked until the transaction ends, so `before` is still true when the change is saved.
        const [before] = await tx
          .select(supplier)
          .from(suppliers)
          .where(eq(suppliers.id, id))
          .for("update");
        if (!before) throw notFound();
        const [after = before] =
          Object.keys(changes).length > 0
            ? await tx
                .update(suppliers)
                .set(changes)
                .where(eq(suppliers.id, id))
                .returning(supplier)
            : [];
        return {
          result: after,
          changes: [
            {
              action: "update",
              entityType: "supplier",
              entityId: id,
              before,
              after,
            },
          ],
        };
      });
    },
  });
};
