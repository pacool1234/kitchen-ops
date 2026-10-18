import { endpoints, type StoreroomPage } from "@kitchen-ops/shared";
import { and, count, eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { storerooms } from "../db/schema";
import { notFound } from "../errors";
import { contains, pageWindow, spanishOrder, withStatus } from "./lists";

// Storerooms (#88): where stock is kept. Everyone signed in reads them; office and owner change
// them (the contract says who). Every change goes through the audit log.

/** A storeroom as the API answers it (`Storeroom` in packages/shared). */
const storeroom = {
  id: storerooms.id,
  name: storerooms.name,
  type: storerooms.type,
  active: storerooms.active,
};

export const storeroomRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.listStorerooms),
    handler: async ({ query }): Promise<StoreroomPage> => {
      const matching = and(
        query.q ? contains(storerooms.name, query.q) : undefined,
        query.type ? eq(storerooms.type, query.type) : undefined,
        withStatus(storerooms.active, query.status),
      );
      const { limit, offset } = pageWindow(query);
      const [items, [counted]] = await Promise.all([
        db
          .select(storeroom)
          .from(storerooms)
          .where(matching)
          .orderBy(spanishOrder(storerooms.name), storerooms.id)
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(storerooms).where(matching),
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
    ...routeFor(endpoints.getStoreroom),
    handler: async ({ params }) => {
      const [found] = await db
        .select(storeroom)
        .from(storerooms)
        .where(eq(storerooms.id, params.id));
      if (!found) throw notFound();
      return found;
    },
  });

  app.route({
    ...routeFor(endpoints.createStoreroom),
    handler: async (request, reply) => {
      const created = await audited(db, auditContext(request), async (tx) => {
        const [row] = await tx
          .insert(storerooms)
          .values(request.body)
          .returning(storeroom);
        return {
          result: row!,
          changes: [
            {
              action: "create",
              entityType: "storeroom",
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
    ...routeFor(endpoints.updateStoreroom),
    handler: async (request) => {
      const { id } = request.params;
      const changes = request.body;
      return audited(db, auditContext(request), async (tx) => {
        // Locked until the transaction ends, so `before` is still true when the change is saved.
        const [before] = await tx
          .select(storeroom)
          .from(storerooms)
          .where(eq(storerooms.id, id))
          .for("update");
        if (!before) throw notFound();
        const [after = before] =
          Object.keys(changes).length > 0
            ? await tx
                .update(storerooms)
                .set(changes)
                .where(eq(storerooms.id, id))
                .returning(storeroom)
            : [];
        return {
          result: after,
          changes: [
            {
              action: "update",
              entityType: "storeroom",
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
