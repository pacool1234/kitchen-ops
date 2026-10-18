import {
  buildPath,
  endpoints,
  type Endpoint,
  type Role,
} from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import {
  products,
  storerooms,
  supplierProducts,
  suppliers,
  users,
} from "../db/schema";
import { signedInAs, signedInAsOwner } from "../test/auth";
import { syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";

// Who may call each catalogue route (#88, spec section 6): everyone signed in reads, office and
// owner write. The answer expected for each role comes from the endpoint's access in the
// contract, so this test and the contract can't disagree.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

const CATALOGUE_PATHS = [
  "/api/storerooms",
  "/api/suppliers",
  "/api/products",
  "/api/supplier-products",
];

interface Ids {
  storeroom: string;
  supplier: string;
  product: string;
  supplierProduct: string;
}

// Each call needs its own name and tax ID, so a write by one role can't clash with another's.
let n = 0;
const next = () => ++n;

/** A valid request to each catalogue endpoint, by its name in the contract. */
const REQUESTS: Record<
  string,
  (ids: Ids) => { params?: Record<string, string>; body?: object }
> = {
  listStorerooms: () => ({}),
  getStoreroom: (ids) => ({ params: { id: ids.storeroom } }),
  createStoreroom: () => ({ body: { name: `Sala ${next()}`, type: "bar" } }),
  updateStoreroom: (ids) => ({
    params: { id: ids.storeroom },
    body: { name: `Sala ${next()}` },
  }),
  listSuppliers: () => ({}),
  getSupplier: (ids) => ({ params: { id: ids.supplier } }),
  createSupplier: () => ({
    body: { name: "Proveedor", taxId: syntheticCif(next()) },
  }),
  updateSupplier: (ids) => ({
    params: { id: ids.supplier },
    body: { taxId: syntheticCif(next()) },
  }),
  listProducts: () => ({}),
  getProduct: (ids) => ({ params: { id: ids.product } }),
  createProduct: () => ({
    body: { name: `Producto ${next()}`, baseUnit: "g", category: "other" },
  }),
  updateProduct: (ids) => ({
    params: { id: ids.product },
    body: { name: `Producto ${next()}` },
  }),
  listSupplierProducts: () => ({}),
  getSupplierProduct: (ids) => ({ params: { id: ids.supplierProduct } }),
  createSupplierProduct: (ids) => ({
    body: {
      supplierId: ids.supplier,
      code: `C${next()}`,
      description: "Tomate, kilo",
      productId: ids.product,
      pack: { quantity: "1", unit: "g" },
    },
  }),
  updateSupplierProduct: (ids) => ({
    params: { id: ids.supplierProduct },
    body: { code: `C${next()}` },
  }),
};

const catalogue = Object.entries(endpoints as Record<string, Endpoint>).filter(
  ([, e]) => CATALOGUE_PATHS.some((path) => e.path.startsWith(path)),
);

/** What a caller gets: 401 without a session, 403 for a role the endpoint doesn't allow. */
function expectedStatus(e: Endpoint, role: Role | null) {
  if (role === null) return 401;
  const allowed =
    e.access === "signed-in" ||
    (typeof e.access === "object" && e.access.roles.includes(role));
  return allowed ? (e.status ?? 200) : 403;
}

const cookies: Partial<Record<Role, string>> = {};
let ids: Ids;
beforeAll(async () => {
  await db.execute(
    sql`truncate ${users}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
  );
  cookies.counter = await signedInAs(app, auth, "counter");
  cookies.office = await signedInAs(app, auth, "office");
  cookies.owner = await signedInAsOwner(app, auth);
  const [storeroom] = await db
    .insert(storerooms)
    .values({ name: "Barra", type: "bar" })
    .returning();
  const [supplier] = await db
    .insert(suppliers)
    .values({ name: "Frutas del Huerto, S.L.", taxId: syntheticCif(0) })
    .returning();
  const [product] = await db
    .insert(products)
    .values({ name: "Tomate", baseUnit: "g", category: "produce" })
    .returning();
  const [supplierProduct] = await db
    .insert(supplierProducts)
    .values({
      supplierId: supplier!.id,
      code: "TOM",
      description: "Tomate, gramo",
      productId: product!.id,
      packQuantity: "1",
      packUnit: "g",
    })
    .returning();
  ids = {
    storeroom: storeroom!.id,
    supplier: supplier!.id,
    product: product!.id,
    supplierProduct: supplierProduct!.id,
  };
});

describe("who may call each catalogue route (#88)", () => {
  it("every catalogue endpoint in the contract has a request here", () => {
    expect(Object.keys(REQUESTS).sort()).toEqual(
      catalogue.map(([name]) => name).sort(),
    );
  });

  for (const [name, e] of catalogue) {
    for (const role of [null, "counter", "office", "owner"] as const) {
      const status = expectedStatus(e, role);
      it(`${name} (${e.method} ${e.path}) as ${role ?? "nobody"}: ${status}`, async () => {
        const { params, body } = REQUESTS[name]!(ids);
        const response = await app.inject({
          method: e.method,
          url: buildPath(e.path, params ?? {}),
          headers: role ? { cookie: cookies[role]! } : {},
          ...(body ? { payload: body } : {}),
        });
        expect(response.statusCode, response.body).toBe(status);
      });
    }
  }
});
