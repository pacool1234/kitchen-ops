import { randomUUID } from "node:crypto";
import multipart from "@fastify/multipart";
import { UPLOAD_LIMITS } from "@kitchen-ops/shared";
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
import { catalogueRoutes } from "./catalogue/routes";
import { extractionConfig, storageConfig, type Config } from "./config";
import { openApiRoutes, registerOpenApi } from "./contract";
import { createDb } from "./db/client";
import { documentRoutes } from "./documents/routes";
import { registerErrors } from "./errors";
import { createJobs, JOB_SETTINGS, type JobSettings } from "./extraction/jobs";
import { failedRead, tryReading } from "./extraction/read";
import { readerFor, type Reader } from "./extraction/reader";
import { healthRoutes } from "./health/routes";
import { tagRequest } from "./sentry";
import { createS3Storage } from "./storage/s3";
import type { Storage } from "./storage/storage";

export interface BuildAppOptions {
  /** Where pino writes log lines. Defaults to stdout; tests pass a stream to read them. */
  logStream?: NodeJS.WritableStream;
  /**
   * Object storage for documents' files. Defaults to the S3 storage the config describes, or
   * none (decision 0029); tests pass an in-memory one.
   */
  storage?: Storage;
  /**
   * What reads documents (#104). Defaults to what the config says (EXTRACTION_MODEL,
   * OPENROUTER_API_KEY); null reads none, and uploads wait, queued. Tests pass a scripted client.
   */
  reader?: Reader | null;
  /**
   * Background jobs' timings (src/extraction/jobs.ts): tests try again at once. `false` starts
   * none, for the OpenAPI writer, which has no database.
   */
  jobs?: Partial<JobSettings> | false;
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
  // Every refusal answers an ErrorBody, with a code per field for invalid input.
  registerErrors(app);

  // Return the ID so a problem a user reports can be found in the logs; errors in Sentry carry it too.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    tagRequest(request.id);
  });

  // The pool connects lazily, on the first query; closed with the app, after the jobs stop.
  const { db, close } = createDb(config.DATABASE_URL);
  const jobs = createJobs(
    config.DATABASE_URL,
    { ...JOB_SETTINGS, ...(options.jobs || {}) },
    app.log,
  );
  app.addHook("onClose", async () => {
    await jobs.stop();
    await close();
  });

  // Uploads (#102): files are read from multipart/form-data, each cut off just past the limit,
  // so that what's too big is refused by field instead of failing the whole request.
  app.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: UPLOAD_LIMITS.maxFileBytes + 1,
      files: UPLOAD_LIMITS.maxPhotos + 1,
      fields: 10,
    },
  });

  const s3 = storageConfig(config);
  const storage = options.storage ?? (s3 ? createS3Storage(s3) : null);
  if (!storage) {
    app.log.warn("documents are off: no object storage is configured (S3_*)");
  }

  // Reading documents (#104, decision 0030): in this process, one at a time, once it's ready.
  const extraction = extractionConfig(config);
  const reader =
    options.reader !== undefined
      ? options.reader
      : extraction && readerFor(extraction);
  if (!reader) {
    app.log.warn(
      "documents aren't read: set OPENROUTER_API_KEY (or EXTRACTION_MODEL=fake locally); uploads wait, queued",
    );
  }
  app.addHook("onReady", async () => {
    if (options.jobs === false) return;
    await jobs.start();
    if (reader && storage) {
      const context = { db, storage, reader, log: app.log };
      await jobs.work({
        read: (job) => tryReading(context, job),
        failed: failedRead(db),
      });
    }
  });

  // Before the routes: it builds the OpenAPI document from each route as it is registered.
  registerOpenApi(app);
  registerAuth(app, createAuth(db, config));
  app.register(openApiRoutes);
  app.register(healthRoutes, { version: config.APP_VERSION });
  app.register(meRoutes, { db });
  app.register(auditRoutes, { db });
  app.register(catalogueRoutes, { db });
  app.register(documentRoutes, { db, storage, jobs });

  return app;
}
