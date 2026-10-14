import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Config } from "./config";
import { healthRoutes } from "./routes/health";

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

  // Return the ID so a problem a user reports can be found in the logs.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.register(healthRoutes, { version: config.APP_VERSION });

  return app;
}
