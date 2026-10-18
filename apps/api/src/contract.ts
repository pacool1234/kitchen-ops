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

/** A contract endpoint as Fastify route options: method, URL, schemas and who may call it. */
export function routeFor<const E extends Endpoint>(e: E) {
  return {
    method: e.method,
    url: e.path,
    config: routeConfig(e.access),
    schema: {
      summary: e.summary,
      ...(e.params ? { params: e.params } : {}),
      ...(e.query ? { querystring: e.query } : {}),
      ...(e.body ? { body: e.body } : {}),
      response:
        e.access === "public"
          ? { 200: e.response }
          : { 200: e.response, 401: ErrorBody, 403: ErrorBody },
    },
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
      for (const e of Object.values(endpoints)) {
        const operation =
          document.paths?.[openApiPath(e.path)]?.[e.method.toLowerCase()];
        if (operation) operation["x-roles"] = rolesDescription(e.access);
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
