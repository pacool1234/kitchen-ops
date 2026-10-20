import {
  Product,
  Supplier,
  SupplierProduct,
  SupplierProductPage,
} from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { products, suppliers, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { apiAs, syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";

// Supplier products (#88): how a supplier names and packs one of our products. The pack is a
// quantity in one of the product's units, and its base units come from packages/ledger. Who may
// call each route is in access.test.ts, and the audit log in src/audit/writes-audited.test.ts.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

const MISSING = "0199a000-0000-7000-8000-000000000000";

let api: ReturnType<typeof apiAs>;
let huerto: Supplier;
let granja: Supplier;
let tomate: Product;
let huevos: Product;
beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${products}, ${suppliers}, verifications cascade`,
  );
  api = apiAs(app, await signedInAs(app, auth, "office"));
  huerto = await api.created(
    "/api/suppliers",
    { name: "Frutas El Huerto, S.L.", taxId: syntheticCif(1) },
    Supplier,
  );
  granja = await api.created(
    "/api/suppliers",
    { name: "Granja Los Robles, S.L.", taxId: syntheticCif(2) },
    Supplier,
  );
  tomate = await api.created(
    "/api/products",
    {
      name: "Tomate pera",
      baseUnit: "g",
      category: "produce",
      conversions: [
        { unit: "kg", factor: 1000 },
        { unit: "caja", factor: 6000 },
      ],
    },
    Product,
  );
  huevos = await api.created(
    "/api/products",
    {
      name: "Huevos camperos",
      baseUnit: "unit",
      category: "dairy",
      conversions: [{ unit: "docena", factor: 12_000 }],
    },
    Product,
  );
});

const offer = (change: object = {}) => ({
  supplierId: huerto.id,
  code: "TOM-6",
  description: "Tomate pera, caja de 6 kg",
  productId: tomate.id,
  pack: { quantity: "6", unit: "kg" },
  ...change,
});
const create = (body: object) =>
  api.created("/api/supplier-products", body, SupplierProduct);
const list = (query = "") =>
  api.read(`/api/supplier-products${query}`, SupplierProductPage);
const codes = (page: SupplierProductPage) => page.items.map((s) => s.code);

describe("POST /api/supplier-products", () => {
  it("creates one, with its supplier's and product's names and its pack in base units: 201", async () => {
    expect(await create(offer())).toEqual({
      id: expect.any(String),
      supplier: { id: huerto.id, name: "Frutas El Huerto, S.L." },
      code: "TOM-6",
      description: "Tomate pera, caja de 6 kg",
      product: { id: tomate.id, name: "Tomate pera", baseUnit: "g" },
      pack: { quantity: "6", unit: "kg" },
      packBaseUnits: 6000,
      active: true,
    });
  });

  it.each([
    ["a fraction of a conversion", { quantity: "0.5", unit: "caja" }, 3000],
    ["the base unit itself", { quantity: "500", unit: "g" }, 500],
  ])("a pack in %s", async (_, pack, baseUnits) => {
    expect((await create(offer({ pack }))).packBaseUnits).toBe(baseUnits);
  });

  it("counted products are in thousandths of a unit: 2.5 dozen eggs is 30 000", async () => {
    const eggs = await create(
      offer({
        code: "HUE",
        productId: huevos.id,
        pack: { quantity: "2.5", unit: "docena" },
      }),
    );
    expect(eggs.packBaseUnits).toBe(30_000);
    expect(
      (
        await create(
          offer({
            code: "HUE-30",
            productId: huevos.id,
            pack: { quantity: "30", unit: "unit" },
          }),
        )
      ).packBaseUnits,
    ).toBe(30_000);
  });

  it.each([
    [{ pack: { quantity: "6", unit: "KG" } }, { "pack.unit": "unknown_unit" }],
    [
      { pack: { quantity: "6", unit: "docena" } },
      { "pack.unit": "unknown_unit" },
    ],
    [
      { pack: { quantity: "0.0001", unit: "kg" } },
      { "pack.quantity": "not_whole_base_units" },
    ],
    [{ pack: { quantity: "0", unit: "kg" } }, { "pack.quantity": "too_small" }],
    [{ pack: { quantity: "2,5", unit: "kg" } }, { "pack.quantity": "invalid" }],
    [{ supplierId: MISSING }, { supplierId: "not_found" }],
    [{ productId: MISSING }, { productId: "not_found" }],
    [{ code: "x".repeat(51) }, { code: "too_long" }],
    [{ description: "  " }, { description: "required" }],
  ])("refuses %j, naming the field: 400", async (change, fields) => {
    const response = await api.send(
      "POST",
      "/api/supplier-products",
      offer(change),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_input", fields });
    expect((await list("?status=all")).total).toBe(0);
  });

  it("a supplier's code is its own: taken for the same supplier (409), free for another", async () => {
    await create(offer());
    const taken = await api.send(
      "POST",
      "/api/supplier-products",
      offer({ description: "Otra" }),
    );
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({
      error: "conflict",
      fields: { code: "taken" },
    });

    await create(offer({ supplierId: granja.id }));
    expect((await list()).total).toBe(2);
  });
});

describe("a supplier that prints no codes (decision 0035)", () => {
  it("a code left out, blank or null is none, and many supplier products can have none", async () => {
    const created = await Promise.all([
      create(offer({ code: undefined })),
      create(offer({ code: "  ", description: "Tomate pera, kilo" })),
      create(offer({ code: null, description: "Tomate pera, granel" })),
    ]);
    expect(created.map((s) => s.code)).toEqual([null, null, null]);
    expect((await list()).total).toBe(3);
  });

  it("a change can clear a code, or give one", async () => {
    const tomatoes = await create(offer());
    const url = `/api/supplier-products/${tomatoes.id}`;
    expect(
      (await api.updated(url, { code: "" }, SupplierProduct)).code,
    ).toBeNull();
    expect(
      (await api.updated(url, { code: " TP-6 " }, SupplierProduct)).code,
    ).toBe("TP-6");
  });
});

describe("GET /api/supplier-products", () => {
  beforeEach(async () => {
    await create(offer());
    await create(
      offer({
        code: "TOM-1",
        description: "Tomate pera, kilo",
        pack: { quantity: "1", unit: "kg" },
      }),
    );
    await create(
      offer({
        supplierId: granja.id,
        code: "H12",
        description: "Huevos camperos, docena",
        productId: huevos.id,
        pack: { quantity: "1", unit: "docena" },
      }),
    );
  });

  it("lists the active ones by description, in Spanish order", async () => {
    expect(codes(await list())).toEqual(["H12", "TOM-6", "TOM-1"]);
  });

  it("q looks in the code and the description, whatever the case and accents", async () => {
    expect(codes(await list("?q=tom-1"))).toEqual(["TOM-1"]);
    expect(codes(await list("?q=DOCENA"))).toEqual(["H12"]);
    expect(codes(await list(`?q=${encodeURIComponent("kílo")}`))).toEqual([
      "TOM-1",
    ]);
  });

  it("filters by supplier and by product, with the total they match", async () => {
    expect(await list(`?supplierId=${granja.id}`)).toMatchObject({
      items: [{ code: "H12" }],
      total: 1,
    });
    expect(codes(await list(`?productId=${tomate.id}`))).toEqual([
      "TOM-6",
      "TOM-1",
    ]);
    expect((await list(`?productId=${tomate.id}&pageSize=1`)).total).toBe(2);
  });
});

describe("GET /api/supplier-products/:id", () => {
  it("answers with it, or 404", async () => {
    const tom = await create(offer());
    expect(
      await api.read(`/api/supplier-products/${tom.id}`, SupplierProduct),
    ).toEqual(tom);
    expect(
      (await api.send("GET", `/api/supplier-products/${MISSING}`)).statusCode,
    ).toBe(404);
  });
});

describe("PATCH /api/supplier-products/:id", () => {
  const update = (id: string, body: object) =>
    api.send("PATCH", `/api/supplier-products/${id}`, body);

  it("changes only what it's sent; a new pack gives new base units", async () => {
    const tom = await create(offer());
    const changed = await api.updated(
      `/api/supplier-products/${tom.id}`,
      { pack: { quantity: "1", unit: "caja" } },
      SupplierProduct,
    );
    expect(changed).toEqual({
      ...tom,
      pack: { quantity: "1", unit: "caja" },
      packBaseUnits: 6000,
    });
  });

  it("another product: the pack must be in one of its units", async () => {
    const tom = await create(offer());
    const refused = await update(tom.id, { productId: huevos.id });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({
      error: "invalid_input",
      fields: { "pack.unit": "unknown_unit" },
    });

    const moved = await api.updated(
      `/api/supplier-products/${tom.id}`,
      { productId: huevos.id, pack: { quantity: "1", unit: "docena" } },
      SupplierProduct,
    );
    expect(moved.product).toEqual({
      id: huevos.id,
      name: "Huevos camperos",
      baseUnit: "unit",
    });
    expect(moved.packBaseUnits).toBe(12_000);
  });

  it("refuses another supplier (400), a code the supplier already uses (409), and a missing one (404)", async () => {
    const tom = await create(offer());
    const kilo = await create(offer({ code: "TOM-1" }));
    expect((await update(tom.id, { supplierId: granja.id })).json()).toEqual({
      error: "invalid_input",
      fields: { supplierId: "unknown_field" },
    });
    const taken = await update(kilo.id, { code: "TOM-6" });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({
      error: "conflict",
      fields: { code: "taken" },
    });
    expect((await update(MISSING, { code: "X" })).statusCode).toBe(404);
  });

  it("deactivates one, which can still be read", async () => {
    const tom = await create(offer());
    await api.updated(
      `/api/supplier-products/${tom.id}`,
      { active: false },
      SupplierProduct,
    );
    expect((await list()).total).toBe(0);
    expect(codes(await list("?status=inactive"))).toEqual(["TOM-6"]);
  });
});
