import { endpoints } from "@kitchen-ops/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { routeFor } from "../contract";

export const healthRoutes: FastifyPluginAsyncZod<{ version: string }> = async (
  app,
  { version },
) => {
  app.route({
    // Public: uptime monitors call it without signing in.
    ...routeFor(endpoints.health),
    // Render's health check calls this every few seconds; log only warnings and errors.
    logLevel: "warn",
    handler: async () => ({ status: "ok" as const, version }),
  });
};
