import { HealthResponse } from "@kitchen-ops/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

export const healthRoutes: FastifyPluginAsyncZod<{ version: string }> = async (
  app,
  { version },
) => {
  app.get(
    "/health",
    {
      config: { public: true }, // uptime monitors call this without signing in
      schema: { response: { 200: HealthResponse } },
    },
    async () => ({ status: "ok" as const, version }),
  );
};
