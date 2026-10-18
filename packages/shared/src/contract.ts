import { z } from "zod";
import { MeResponse, type Role } from "./auth";
import { HealthResponse } from "./health";
import { ProductList } from "./products";

// The API's contract (decision 0022): every endpoint declared once, here. The API registers its
// routes from these entries and the web app calls them through them, so a path, a schema or who
// may call it can't differ between the two. OpenAPI is generated from the routes.

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Who may call an endpoint: anyone, any signed-in user, or only these roles (spec section 6). */
export type Access =
  "public" | "signed-in" | { readonly roles: readonly Role[] };

export interface Endpoint {
  readonly method: HttpMethod;
  /** Fastify style: `:name` for a path parameter. */
  readonly path: `/${string}`;
  /** One line, shown in the OpenAPI document. */
  readonly summary: string;
  readonly access: Access;
  readonly params?: z.ZodObject;
  readonly query?: z.ZodObject;
  readonly body?: z.ZodType;
  /** The 200 response. Errors are always `ErrorBody`. */
  readonly response: z.ZodType;
}

/** Declares an endpoint, keeping its exact types for the API's handlers and the web's calls. */
export function endpoint<const E extends Endpoint>(definition: E): E {
  return definition;
}

/** What every error answer holds: a short code the web app translates, e.g. `forbidden`. */
export const ErrorBody = z.object({ error: z.string() });
export type ErrorBody = z.infer<typeof ErrorBody>;

/** The OpenAPI document, checked only as far as the web app could rely on it. */
export const OpenApiDocument = z.looseObject({
  openapi: z.string(),
  info: z.looseObject({ title: z.string(), version: z.string() }),
  paths: z.record(z.string(), z.unknown()),
});

export const endpoints = {
  health: endpoint({
    method: "GET",
    path: "/health",
    summary: "The API is up, and which build is running",
    access: "public",
    response: HealthResponse,
  }),
  openApi: endpoint({
    method: "GET",
    path: "/api/openapi.json",
    summary: "This API's OpenAPI document",
    access: "public",
    response: OpenApiDocument,
  }),
  me: endpoint({
    method: "GET",
    path: "/api/me",
    summary: "Who is signed in",
    access: "signed-in",
    response: MeResponse,
  }),
  listProducts: endpoint({
    method: "GET",
    path: "/api/products",
    summary: "The active products",
    access: "signed-in",
    response: ProductList,
  }),
} as const;

/** The path with its `:name` parameters filled in, each encoded so it can't change the route. */
export function buildPath(
  path: string,
  params: Readonly<Record<string, string>>,
): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`missing path parameter "${name}"`);
    }
    return encodeURIComponent(value);
  });
}
