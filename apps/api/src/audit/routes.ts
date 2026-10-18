import { endpoints } from "@kitchen-ops/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { listAuditLog } from "./queries";

/** The audit log, for the owner only (spec section 6: reports and users are the owner's). */
export const auditRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.listAuditLog),
    handler: async (request) => listAuditLog(db, request.query),
  });
};
