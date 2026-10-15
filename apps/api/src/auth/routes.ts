import { MeResponse } from "@kitchen-ops/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

/** Who is signed in. Any role (the auth hook has already checked the session). */
export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/api/me",
    { schema: { response: { 200: MeResponse } } },
    async (request) => request.user!,
  );
};
