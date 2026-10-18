import { z } from "zod";
import { AuditLogPage, AuditLogQuery } from "./audit";
import { MeResponse, UpdateMe, type Role } from "./auth";
import { HealthResponse } from "./health";
import { IdParams } from "./lists";
import {
  NewProduct,
  Product,
  ProductChanges,
  ProductPage,
  ProductQuery,
} from "./products";
import {
  NewStoreroom,
  Storeroom,
  StoreroomChanges,
  StoreroomPage,
  StoreroomQuery,
} from "./storerooms";
import {
  NewSupplierProduct,
  SupplierProduct,
  SupplierProductChanges,
  SupplierProductPage,
  SupplierProductQuery,
} from "./supplier-products";
import {
  NewSupplier,
  Supplier,
  SupplierChanges,
  SupplierPage,
  SupplierQuery,
} from "./suppliers";

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
  /** The success status: 201 for a create, 200 otherwise. */
  readonly status?: 201;
  /** The success response. Errors are always `ErrorBody`. */
  readonly response: z.ZodType;
  /** It may answer 409: a value that must be unique is already taken. */
  readonly conflict?: true;
}

/** Declares an endpoint, keeping its exact types for the API's handlers and the web's calls. */
export function endpoint<const E extends Endpoint>(definition: E): E {
  return definition;
}

/** The OpenAPI document, checked only as far as the web app could rely on it. */
export const OpenApiDocument = z.looseObject({
  openapi: z.string(),
  info: z.looseObject({ title: z.string(), version: z.string() }),
  paths: z.record(z.string(), z.unknown()),
});

/** Who changes the catalogue (spec section 6: "edit products, units and recipes"). */
const CATALOGUE_WRITERS = { roles: ["office", "owner"] } as const;

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
  updateMe: endpoint({
    method: "PATCH",
    path: "/api/me",
    summary: "Change the signed-in user's own settings: their language",
    access: "signed-in",
    body: UpdateMe,
    response: MeResponse,
  }),
  listAuditLog: endpoint({
    method: "GET",
    path: "/api/audit-log",
    summary: "The audit log: every write, newest first, filtered and paged",
    access: { roles: ["owner"] },
    query: AuditLogQuery,
    response: AuditLogPage,
  }),

  // The catalogue (#88): everyone signed in reads it; office and owner change it.
  listStorerooms: endpoint({
    method: "GET",
    path: "/api/storerooms",
    summary:
      "Storerooms, by name: searched, by type and status, a page at a time",
    access: "signed-in",
    query: StoreroomQuery,
    response: StoreroomPage,
  }),
  getStoreroom: endpoint({
    method: "GET",
    path: "/api/storerooms/:id",
    summary: "One storeroom",
    access: "signed-in",
    params: IdParams,
    response: Storeroom,
  }),
  createStoreroom: endpoint({
    method: "POST",
    path: "/api/storerooms",
    summary: "Add a storeroom",
    access: CATALOGUE_WRITERS,
    body: NewStoreroom,
    status: 201,
    response: Storeroom,
    conflict: true,
  }),
  updateStoreroom: endpoint({
    method: "PATCH",
    path: "/api/storerooms/:id",
    summary: "Change a storeroom, or deactivate it",
    access: CATALOGUE_WRITERS,
    params: IdParams,
    body: StoreroomChanges,
    response: Storeroom,
    conflict: true,
  }),
  listSuppliers: endpoint({
    method: "GET",
    path: "/api/suppliers",
    summary:
      "Suppliers, by name: searched by name or tax ID, by status, a page at a time",
    access: "signed-in",
    query: SupplierQuery,
    response: SupplierPage,
  }),
  getSupplier: endpoint({
    method: "GET",
    path: "/api/suppliers/:id",
    summary: "One supplier",
    access: "signed-in",
    params: IdParams,
    response: Supplier,
  }),
  createSupplier: endpoint({
    method: "POST",
    path: "/api/suppliers",
    summary: "Add a supplier, with a Spanish tax ID that passes its checksum",
    access: CATALOGUE_WRITERS,
    body: NewSupplier,
    status: 201,
    response: Supplier,
    conflict: true,
  }),
  updateSupplier: endpoint({
    method: "PATCH",
    path: "/api/suppliers/:id",
    summary: "Change a supplier, or deactivate it",
    access: CATALOGUE_WRITERS,
    params: IdParams,
    body: SupplierChanges,
    response: Supplier,
    conflict: true,
  }),
  listProducts: endpoint({
    method: "GET",
    path: "/api/products",
    summary:
      "Products, by name, with their conversions: searched, by category, storeroom and status, a page at a time",
    access: "signed-in",
    query: ProductQuery,
    response: ProductPage,
  }),
  getProduct: endpoint({
    method: "GET",
    path: "/api/products/:id",
    summary: "One product, with its conversions",
    access: "signed-in",
    params: IdParams,
    response: Product,
  }),
  createProduct: endpoint({
    method: "POST",
    path: "/api/products",
    summary: "Add a product, with its unit conversions",
    access: CATALOGUE_WRITERS,
    body: NewProduct,
    status: 201,
    response: Product,
    conflict: true,
  }),
  updateProduct: endpoint({
    method: "PATCH",
    path: "/api/products/:id",
    summary:
      "Change a product or its conversions, or deactivate it; its base unit never changes",
    access: CATALOGUE_WRITERS,
    params: IdParams,
    body: ProductChanges,
    response: Product,
    conflict: true,
  }),
  listSupplierProducts: endpoint({
    method: "GET",
    path: "/api/supplier-products",
    summary:
      "Supplier products, by description: searched by code or description, by supplier, product and status, a page at a time",
    access: "signed-in",
    query: SupplierProductQuery,
    response: SupplierProductPage,
  }),
  getSupplierProduct: endpoint({
    method: "GET",
    path: "/api/supplier-products/:id",
    summary: "One supplier product, with its pack in base units",
    access: "signed-in",
    params: IdParams,
    response: SupplierProduct,
  }),
  createSupplierProduct: endpoint({
    method: "POST",
    path: "/api/supplier-products",
    summary: "Add how a supplier names and packs one of our products",
    access: CATALOGUE_WRITERS,
    body: NewSupplierProduct,
    status: 201,
    response: SupplierProduct,
    conflict: true,
  }),
  updateSupplierProduct: endpoint({
    method: "PATCH",
    path: "/api/supplier-products/:id",
    summary: "Change a supplier product, or deactivate it",
    access: CATALOGUE_WRITERS,
    params: IdParams,
    body: SupplierProductChanges,
    response: SupplierProduct,
    conflict: true,
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
