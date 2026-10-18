import {
  FIELD_ERROR_CODES,
  type ErrorBody,
  type FieldErrorCode,
} from "@kitchen-ops/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { UNIQUE_FIELDS } from "./db/schema";

// Every refusal answers an ErrorBody (#88, decision 0026): a code, and for invalid input a code
// per field, keyed by its path, so the web app can show each message next to its field.
// Anything else is a bug: it goes on to Fastify's own handler, a 500, logged and sent to Sentry.

/** A refusal a handler throws: 404 for a row that doesn't exist, for example. */
export class HttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    readonly fields?: Readonly<Record<string, FieldErrorCode>>,
  ) {
    super(code);
  }
}

export const notFound = () => new HttpError(404, "not_found");

/** One Zod issue, as fastify-type-provider-zod hands it on. */
interface Issue {
  keyword: string;
  instancePath: string;
  params: Record<string, unknown>;
}

function valueAt(input: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined,
    input,
  );
}

const isFieldErrorCode = (code: unknown): code is FieldErrorCode =>
  (FIELD_ERROR_CODES as readonly unknown[]).includes(code);

/** Why Zod refused a field, as one of the codes the web app has a message for. */
function fieldCode(issue: Issue, value: unknown): FieldErrorCode {
  const { keyword, params } = issue;
  // Not sent at all, whatever Zod expected there (a string, one of an enum's values…).
  if (value === undefined) return "required";
  switch (keyword) {
    case "too_small":
      if (params.origin !== "string") return "too_small";
      // Blank once trimmed counts as missing.
      return Number(params.minimum) <= 1 ? "required" : "too_short";
    case "too_big":
      return params.origin === "string" ? "too_long" : "too_big";
    case "custom": {
      // A refinement's own code: `fieldError("invalid_tax_id")` in packages/shared.
      const code = (params.params as { code?: unknown } | undefined)?.code;
      return isFieldErrorCode(code) ? code : "invalid";
    }
    default:
      return "invalid";
  }
}

/** Each refused field's path (`lines.1.quantity`) and code; the first issue per field wins. */
export function fieldErrors(
  issues: readonly Issue[],
  input: unknown,
): Record<string, FieldErrorCode> {
  const fields: Record<string, FieldErrorCode> = {};
  const add = (path: readonly string[], code: FieldErrorCode) => {
    fields[path.join(".")] ??= code;
  };
  for (const issue of issues) {
    const path =
      issue.instancePath === "/" ? [] : issue.instancePath.split("/").slice(1);
    if (issue.keyword === "unrecognized_keys") {
      for (const key of issue.params.keys as string[]) {
        add([...path, key], "unknown_field");
      }
    } else {
      add(path, fieldCode(issue, valueAt(input, path)));
    }
  }
  return fields;
}

/** What the request sent for the part that failed validation: its body, query or path. */
function validatedInput(request: FastifyRequest, context: string | undefined) {
  if (context === "querystring") return request.query;
  if (context === "params") return request.params;
  return request.body;
}

/** The unique index Postgres refused a duplicate on (23505), if that is what this error is. */
function uniqueViolation(error: unknown): string | undefined {
  // Drizzle wraps Postgres's error: look along the causes.
  for (let e = error, depth = 0; e && depth < 5; depth++) {
    const { code, constraint, cause } = e as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (code === "23505")
      return typeof constraint === "string" ? constraint : "";
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
        fields: fieldErrors(error.validation as unknown as Issue[], input),
      });
    }
    if (error instanceof HttpError) {
      return send(error.status, {
        error: error.code,
        ...(error.fields ? { fields: { ...error.fields } } : {}),
      });
    }
    const constraint = uniqueViolation(error);
    if (constraint !== undefined) {
      const field = UNIQUE_FIELDS[constraint];
      return send(409, {
        error: "conflict",
        ...(field ? { fields: { [field]: "taken" } } : {}),
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
