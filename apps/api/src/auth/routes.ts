import { endpoints } from "@kitchen-ops/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { routeFor } from "../contract";

/** Who is signed in. Any role (the auth hook has already checked the session). */
export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    ...routeFor(endpoints.me),
    handler: async (request) => request.user!,
  });
};
