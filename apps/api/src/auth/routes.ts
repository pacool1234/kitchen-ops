import { endpoints } from "@kitchen-ops/shared";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { users } from "../db/schema";

/** Who is signed in, and their own settings. Any role (the auth hook has already checked the session). */
export const meRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.me),
    handler: async (request) => request.user!,
  });

  app.route({
    ...routeFor(endpoints.updateMe),
    handler: async (request) => {
      const user = request.user!;
      const { locale } = request.body;
      return audited(db, auditContext(request), async (tx) => {
        if (locale !== user.locale) {
          await tx.update(users).set({ locale }).where(eq(users.id, user.id));
        }
        return {
          result: { ...user, locale },
          changes: [
            {
              action: "update",
              entityType: "user",
              entityId: user.id,
              before: { locale: user.locale },
              after: { locale },
            },
          ],
        };
      });
    },
  });
};
