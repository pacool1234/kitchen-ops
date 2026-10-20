import {
  fieldErrors,
  type ErrorBody,
  type FieldErrorCode,
  type FieldIssue,
} from "@kitchen-ops/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { FOREIGN_KEY_FIELDS, UNIQUE_FIELDS } from "./db/schema";

// Every refusal answers an ErrorBody (#88, decision 0026): a code, and for invalid input a code
// per field, keyed by its path, so the web app can show each message next to its field.
// Anything else is a bug: it goes on to Fastify's own handler, a 500, logged and sent to Sentry.

/** A refusal a handler throws: 404 for a row that doesn't exist, for example. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    readonly code: string,
    readonly fields?: Readonly<Record<string, FieldErrorCode>>,
    /** For a file already received: the document that has it (#102). */
    readonly duplicateOf?: string,
  ) {
    super(code);
  }
}

export const notFound = () => new HttpError(404, "not_found");

/** One Zod issue, as fastify-type-provider-zod hands it on: its code, where, and the rest. */
interface ValidationEntry {
  keyword: string;
  instancePath: string;
  params: Record<string, unknown>;
}

/** Back to Zod's own shape, for `fieldErrors` in packages/shared. */
function asIssue({
  keyword,
  instancePath,
  params,
}: ValidationEntry): FieldIssue {
  return {
    ...params,
    code: keyword,
    path: instancePath === "/" ? [] : instancePath.split("/").slice(1),
  };
}

/** What the request sent for the part that failed validation: its body, query or path. */
function validatedInput(request: FastifyRequest, context: string | undefined) {
  if (context === "querystring") return request.query;
  if (context === "params") return request.params;
  return request.body;
}

/**
 * The constraint Postgres refused a write on, if that's what this error is: a duplicate (23505)
 * or a reference to a row that doesn't exist (23503).
 */
function refusedBy(
  error: unknown,
): { kind: "unique" | "foreign_key"; constraint: string } | undefined {
  // Drizzle wraps Postgres's error: look along the causes.
  for (let e = error, depth = 0; e && depth < 5; depth++) {
    const { code, constraint, cause } = e as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    const name = typeof constraint === "string" ? constraint : "";
    if (code === "23505") return { kind: "unique", constraint: name };
    if (code === "23503") return { kind: "foreign_key", constraint: name };
    e = cause;
  }
  return undefined;
}

/** Answers every refusal with an ErrorBody. Call it before registering the routes. */
export function registerErrors(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const send = (status: number, body: ErrorBody) =>
      reply.code(status).send(body);

    if (hasZodFastifySchemaValidationErrors(error)) {
      const input = validatedInput(request, error.validationContext);
      return send(400, {
        error: "invalid_input",
        fields: fieldErrors(
          (error.validation as unknown as ValidationEntry[]).map(asIssue),
          input,
        ),
      });
    }
    if (error instanceof HttpError) {
      return send(error.status, {
        error: error.code,
        ...(error.fields ? { fields: { ...error.fields } } : {}),
        ...(error.duplicateOf ? { duplicateOf: error.duplicateOf } : {}),
      });
    }
    const refused = refusedBy(error);
    if (refused?.kind === "unique") {
      const field = UNIQUE_FIELDS[refused.constraint];
      return send(409, {
        error: "conflict",
        ...(field ? { fields: { [field]: "taken" } } : {}),
      });
    }
    if (refused?.kind === "foreign_key") {
      const field = FOREIGN_KEY_FIELDS[refused.constraint];
      return send(400, {
        error: "invalid_input",
        ...(field ? { fields: { [field]: "not_found" } } : {}),
      });
    }
    // Fastify's own refusals of a body it can't read: not JSON, for example.
    if ((error as { statusCode?: number }).statusCode === 400) {
      return send(400, { error: "invalid_input" });
    }
    // A bug: Fastify's own handler logs it and answers 500.
    throw error;
  });
}
