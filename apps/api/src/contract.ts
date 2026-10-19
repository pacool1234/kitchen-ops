import swagger from "@fastify/swagger";
import {
  endpoints,
  ErrorBody,
  type Access,
  type Endpoint,
} from "@kitchen-ops/shared";
import type { FastifyContextConfig, FastifyInstance } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
} from "fastify-type-provider-zod";

// Routes are registered from the contract in packages/shared (decision 0022), and OpenAPI is
// generated from the registered routes. A test refuses any route that isn't in the contract.

/** `apps/api/openapi.json`: the document as committed, so every API change shows in review. */
export const OPENAPI_FILE = new URL("../openapi.json", import.meta.url);

/** The route config the auth hook reads, for who may call an endpoint. */
export function routeConfig(
  access: Access,
): Pick<FastifyContextConfig, "public" | "roles"> {
  if (access === "public") return { public: true };
  if (access === "signed-in") return {};
  return { roles: access.roles };
}

/** Who may call an endpoint, as the OpenAPI document's `x-roles` says it. */
function rolesDescription(access: Access): string | readonly string[] {
  if (access === "public") return "public";
  if (access === "signed-in") return "any signed-in user";
  return access.roles;
}

/** `{ [As]: schema }` if the endpoint has a `Key` schema, else nothing: Fastify's name for it. */
type SchemaPart<E, Key extends string, As extends string> =
  E extends Record<Key, infer S> ? Record<As, S> : unknown;

/** The success response, under its status: 201 for a create, 200 otherwise. */
type Success<E extends Endpoint> = E extends { status: 201 }
  ? { 201: E["response"] }
  : { 200: E["response"] };

/** The refusals an endpoint may answer, each an ErrorBody. */
type Refusals = Partial<
  Record<400 | 401 | 403 | 404 | 409 | 503, typeof ErrorBody>
>;

/**
 * A contract endpoint as Fastify route options: method, URL, schemas and who may call it. Its
 * responses describe each refusal it can answer: 401 and 403 unless it's public, 400 if it takes
 * input (files included), 404 if its path has an ID, 409 if a value it saves must be unique, and
 * 503 if it needs object storage. An upload takes multipart/form-data, which its handler reads.
 */
export function routeFor<const E extends Endpoint>(e: E) {
  const response = {
    [e.status ?? 200]: e.response,
    ...(e.access === "public" ? {} : { 401: ErrorBody, 403: ErrorBody }),
    ...(e.params || e.query || e.body || e.upload ? { 400: ErrorBody } : {}),
    ...(e.params ? { 404: ErrorBody } : {}),
    ...(e.conflict ? { 409: ErrorBody } : {}),
    ...(e.needsStorage ? { 503: ErrorBody } : {}),
  } as Success<E> & Refusals;
  return {
    method: e.method,
    url: e.path,
    config: routeConfig(e.access),
    // Typed by hand: TypeScript loses each schema's type through the conditional spreads, and
    // the handlers' `request.params`, `.query` and `.body` are inferred from these types.
    schema: {
      summary: e.summary,
      ...(e.upload ? { consumes: ["multipart/form-data"] } : {}),
      ...(e.params ? { params: e.params } : {}),
      ...(e.query ? { querystring: e.query } : {}),
      ...(e.body ? { body: e.body } : {}),
      response,
    } as { summary: string; response: typeof response } & SchemaPart<
      E,
      "params",
      "params"
    > &
      SchemaPart<E, "query", "querystring"> &
      SchemaPart<E, "body", "body">,
  } as const;
}

const openApiPath = (path: string) => path.replace(/:([A-Za-z]+)/g, "{$1}");

/**
 * Builds the OpenAPI document from every route registered after it. Register it before the
 * routes. Each operation gets `x-roles` from its contract entry.
 */
export function registerOpenApi(app: FastifyInstance) {
  app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "kitchen-ops API",
        description:
          "Purchasing and stock control. Sign-in, sign-out and 2FA are Better Auth's routes under /api/auth, not described here.",
        version: "1",
      },
    },
    transform: jsonSchemaTransform,
    transformObject: (input) => {
      const document = jsonSchemaTransformObject(input) as {
        paths?: Record<string, Record<string, Record<string, unknown>>>;
      };
      for (const e of Object.values(endpoints) as Endpoint[]) {
        const operation =
          document.paths?.[openApiPath(e.path)]?.[e.method.toLowerCase()];
        if (!operation) continue;
        operation["x-roles"] = rolesDescription(e.access);
        // An upload's body isn't a Zod schema: its files are described here, as binary parts.
        if (e.upload) {
          operation.requestBody = {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    [e.upload.field]: {
                      type: "array",
                      items: { type: "string", format: "binary" },
                    },
                  },
                  required: [e.upload.field],
                },
              },
            },
          };
        }
      }
      return document as ReturnType<typeof jsonSchemaTransformObject>;
    },
  });
}

/** `GET /api/openapi.json`: the document, for anyone. It describes routes, never data. */
export const openApiRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    ...routeFor(endpoints.openApi),
    handler: async () =>
      app.swagger() as { openapi: string; paths: Record<string, unknown> },
  });
};
