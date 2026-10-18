import {
  Product,
  ProductPage,
  Storeroom,
  Supplier,
  SupplierProduct,
} from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { products, storerooms, suppliers, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { apiAs, syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";

// Products (#88): what is bought, counted and cooked, each with its base unit, its category, a
// default storeroom and its unit conversions. Who may call each route is in access.test.ts, and
// what each write records in the audit log is in src/audit/writes-audited.test.ts.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

let api: ReturnType<typeof apiAs>;
beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
  );
  api = apiAs(app, await signedInAs(app, auth, "office"));
});

const TOMATE = {
  name: "Tomate pera",
  baseUnit: "g",
  category: "produce",
  conversions: [
    { unit: "caja", factor: 6000 },
    { unit: "kg", factor: 1000 },
  ],
};

const create = (body: object) => api.created("/api/products", body, Product);
const list = (query = "") => api.read(`/api/products${query}`, ProductPage);
const names = (page: ProductPage) => page.items.map((p) => p.name);
const MISSING = "0199a000-0000-7000-8000-000000000000";

describe("GET /api/products", () => {
  it("lists the active ones in Spanish order, each with its conversions, smallest first", async () => {
    await create({ name: "Ñoras secas", baseUnit: "g", category: "dry_goods" });
    await create(TOMATE);
    await create({
      name: "aceite de oliva",
      baseUnit: "ml",
      category: "dry_goods",
    });
    await create({ name: "Nueces", baseUnit: "g", category: "dry_goods" });

    const page = await list();
    expect(names(page)).toEqual([
      "aceite de oliva",
      "Nueces",
      "Ñoras secas",
      "Tomate pera",
    ]);
    expect(page.items[3]).toEqual({
      id: expect.any(String),
      name: "Tomate pera",
      baseUnit: "g",
      category: "produce",
      defaultStoreroomId: null,
      active: true,
      conversions: [
        { unit: "kg", factor: 1000 },
        { unit: "caja", factor: 6000 },
      ],
    });
  });

  it("q, category and storeroom filter, and the total counts what they match", async () => {
    const camara = await api.created(
      "/api/storerooms",
      { name: "Cámara", type: "cold_room" },
      Storeroom,
    );
    await create({ ...TOMATE, defaultStoreroomId: camara.id });
    await create({
      name: "Leche entera",
      baseUnit: "ml",
      category: "dairy",
      defaultStoreroomId: camara.id,
    });
    await create({
      name: "Harina de trigo",
      baseUnit: "g",
      category: "dry_goods",
    });

    expect(names(await list("?q=TOMATE"))).toEqual(["Tomate pera"]);
    expect(names(await list("?category=dairy"))).toEqual(["Leche entera"]);
    expect(await list(`?storeroomId=${camara.id}`)).toMatchObject({
      items: [{ name: "Leche entera" }, { name: "Tomate pera" }],
      total: 2,
    });
    expect((await list("?q=leche&category=produce")).total).toBe(0);
  });

  it("status and pages, as every list", async () => {
    for (const name of ["A", "B", "C"]) {
      await create({ name, baseUnit: "unit", category: "other" });
    }
    const [a] = (await list()).items;
    await api.updated(`/api/products/${a!.id}`, { active: false }, Product);
    expect(await list("?pageSize=1&page=2")).toMatchObject({
      items: [{ name: "C" }],
      total: 2,
    });
    expect(names(await list("?status=inactive"))).toEqual(["A"]);
  });

  it("refuses a filter it can't read, naming it: 400", async () => {
    const response = await api.send(
      "GET",
      "/api/products?storeroomId=cámara&category=veg",
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { storeroomId: "invalid", category: "invalid" },
    });
  });
});

describe("GET /api/products/:id", () => {
  it("answers with the product and its conversions, or 404", async () => {
    const tomate = await create(TOMATE);
    expect(await api.read(`/api/products/${tomate.id}`, Product)).toEqual(
      tomate,
    );

    const missing = await api.send("GET", `/api/products/${MISSING}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: "not_found" });
  });
});

describe("POST /api/products", () => {
  it("creates one with its conversions: 201", async () => {
    const tomate = await create(TOMATE);
    expect(tomate).toMatchObject({
      name: "Tomate pera",
      conversions: [
        { unit: "kg", factor: 1000 },
        { unit: "caja", factor: 6000 },
      ],
    });
  });

  it("a product may have no conversions and no default storeroom", async () => {
    expect(
      await create({ name: "Sal fina", baseUnit: "g", category: "dry_goods" }),
    ).toMatchObject({ defaultStoreroomId: null, conversions: [] });
  });

  it.each([
    [
      { conversions: [{ unit: "G", factor: 1 }] },
      { "conversions.0.unit": "reserved" },
    ],
    [
      {
        conversions: [
          { unit: "caja", factor: 6000 },
          { unit: "Caja", factor: 5000 },
        ],
      },
      { "conversions.1.unit": "taken" },
    ],
    [
      { conversions: [{ unit: "caja", factor: 0 }] },
      { "conversions.0.factor": "too_small" },
    ],
    [
      { conversions: [{ unit: "kg", factor: 1.5 }] },
      { "conversions.0.factor": "invalid" },
    ],
    [{ baseUnit: "kg" }, { baseUnit: "invalid" }],
    [{ category: undefined }, { category: "required" }],
    [{ defaultStoreroomId: MISSING }, { defaultStoreroomId: "not_found" }],
  ])("refuses %j, naming the field: 400", async (change, fields) => {
    const response = await api.send("POST", "/api/products", {
      ...TOMATE,
      ...change,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_input", fields });
    expect((await list("?status=all")).total).toBe(0);
  });

  it("a name taken whatever its case: 409", async () => {
    await create(TOMATE);
    const response = await api.send("POST", "/api/products", {
      ...TOMATE,
      name: "TOMATE PERA",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "conflict",
      fields: { name: "taken" },
    });
  });
});

describe("PATCH /api/products/:id", () => {
  const update = (id: string, body: object) =>
    api.send("PATCH", `/api/products/${id}`, body);

  it("changes only what it's sent: conversions not sent stay as they are", async () => {
    const tomate = await create(TOMATE);
    expect(
      await api.updated(
        `/api/products/${tomate.id}`,
        { name: "Tomate rama" },
        Product,
      ),
    ).toEqual({ ...tomate, name: "Tomate rama" });
  });

  it("conversions sent replace the product's list", async () => {
    const tomate = await create(TOMATE);
    const changed = await api.updated(
      `/api/products/${tomate.id}`,
      {
        conversions: [
          { unit: "caja", factor: 5000 },
          { unit: "saco", factor: 25_000 },
        ],
      },
      Product,
    );
    expect(changed.conversions).toEqual([
      { unit: "caja", factor: 5000 },
      { unit: "saco", factor: 25_000 },
    ]);
    expect(
      (await api.read(`/api/products/${tomate.id}`, Product)).conversions,
    ).toEqual(changed.conversions);
  });

  it("the base unit never changes: 400", async () => {
    const tomate = await create(TOMATE);
    const response = await update(tomate.id, { baseUnit: "ml" });
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { baseUnit: "unknown_field" },
    });
  });

  it("new conversions are checked against the product's own base unit", async () => {
    const leche = await create({
      name: "Leche",
      baseUnit: "ml",
      category: "dairy",
    });
    const response = await update(leche.id, {
      conversions: [{ unit: "ML", factor: 1 }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { "conversions.0.unit": "reserved" },
    });
  });

  it("the default storeroom: set, cleared with null, or refused if it doesn't exist", async () => {
    const barra = await api.created(
      "/api/storerooms",
      { name: "Barra", type: "bar" },
      Storeroom,
    );
    const tomate = await create(TOMATE);
    const url = `/api/products/${tomate.id}`;
    expect(
      (await api.updated(url, { defaultStoreroomId: barra.id }, Product))
        .defaultStoreroomId,
    ).toBe(barra.id);
    expect(
      (await api.updated(url, { defaultStoreroomId: null }, Product))
        .defaultStoreroomId,
    ).toBeNull();
    const refused = await update(tomate.id, { defaultStoreroomId: MISSING });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({
      error: "invalid_input",
      fields: { defaultStoreroomId: "not_found" },
    });
  });

  it("one that doesn't exist: 404; a name another product has: 409", async () => {
    expect((await update(MISSING, { name: "X" })).statusCode).toBe(404);
    await create(TOMATE);
    const leche = await create({
      name: "Leche",
      baseUnit: "ml",
      category: "dairy",
    });
    const taken = await update(leche.id, { name: "tomate PERA" });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({
      error: "conflict",
      fields: { name: "taken" },
    });
  });

  describe("a conversion a supplier product's pack uses", () => {
    async function withPack(pack: { quantity: string; unit: string }) {
      const tomate = await create(TOMATE);
      const huerto = await api.created(
        "/api/suppliers",
        { name: "Huerto", taxId: syntheticCif(1) },
        Supplier,
      );
      const packed = await api.created(
        "/api/supplier-products",
        {
          supplierId: huerto.id,
          code: "TOM",
          description: "Tomate pera, media caja",
          productId: tomate.id,
          pack,
        },
        SupplierProduct,
      );
      return { tomate, packed };
    }

    it("can't be removed: 409 in_use, and nothing changes", async () => {
      const { tomate } = await withPack({ quantity: "0.5", unit: "caja" });
      const response = await update(tomate.id, {
        conversions: [{ unit: "kg", factor: 1000 }],
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: "conflict",
        fields: { conversions: "in_use" },
      });
      expect(await api.read(`/api/products/${tomate.id}`, Product)).toEqual(
        tomate,
      );
    });

    it("may change its factor, and the pack follows; not to one that leaves the pack a fraction of a base unit", async () => {
      const { tomate, packed } = await withPack({
        quantity: "0.5",
        unit: "caja",
      });
      const refused = await update(tomate.id, {
        conversions: [
          { unit: "kg", factor: 1000 },
          { unit: "caja", factor: 6001 },
        ],
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toEqual({
        error: "conflict",
        fields: { "conversions.1.factor": "in_use" },
      });

      await api.updated(
        `/api/products/${tomate.id}`,
        {
          conversions: [
            { unit: "kg", factor: 1000 },
            { unit: "caja", factor: 5000 },
          ],
        },
        Product,
      );
      expect(
        (await api.read(`/api/supplier-products/${packed.id}`, SupplierProduct))
          .packBaseUnits,
      ).toBe(2500);
    });
  });
});
