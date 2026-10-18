import { endpoints } from "@kitchen-ops/shared";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
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
      await db
        .update(users)
        .set({ locale: request.body.locale })
        .where(eq(users.id, user.id));
      return { ...user, locale: request.body.locale };
    },
  });
};
