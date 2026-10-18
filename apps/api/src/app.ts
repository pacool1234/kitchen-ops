import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { auditRoutes } from "./audit/routes";
import { createAuth } from "./auth/auth";
import { registerAuth } from "./auth/fastify";
import { meRoutes } from "./auth/routes";
import type { Config } from "./config";
import { openApiRoutes, registerOpenApi } from "./contract";
import { createDb } from "./db/client";
import { healthRoutes } from "./health/routes";
import { productRoutes } from "./products/routes";
import { tagRequest } from "./sentry";

export interface BuildAppOptions {
  /** Where pino writes log lines. Defaults to stdout; tests pass a stream to read them. */
  logStream?: NodeJS.WritableStream;
}

/** Builds the API without listening on a port, so tests can call it with `inject`. */
export function buildApp(config: Config, options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    // Every request gets a fresh ID, logged as `reqId`. An x-request-id sent by the client is
    // ignored, so callers cannot write arbitrary values into the logs.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  }).withTypeProvider<ZodTypeProvider>();

  // Request and response schemas are Zod schemas (from packages/shared).
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Return the ID so a problem a user reports can be found in the logs; errors in Sentry carry it too.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    tagRequest(request.id);
  });

  // The pool connects lazily, on the first query; closed with the app.
  const { db, close } = createDb(config.DATABASE_URL);
  app.addHook("onClose", close);

  // Before the routes: it builds the OpenAPI document from each route as it is registered.
  registerOpenApi(app);
  registerAuth(app, createAuth(db, config));
  app.register(openApiRoutes);
  app.register(healthRoutes, { version: config.APP_VERSION });
  app.register(meRoutes, { db });
  app.register(productRoutes, { db });
  app.register(auditRoutes, { db });

  return app;
}
