import { Supplier, SupplierPage } from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { suppliers, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";

// Suppliers (#88): who the restaurant buys from, each with a Spanish tax ID that passes its
// checksum. Who may call each route is in access.test.ts, and what each write records in the
// audit log is in src/audit/writes-audited.test.ts.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

let cookie: string;
beforeEach(async () => {
  await db.execute(sql`truncate ${users}, ${suppliers}, verifications cascade`);
  cookie = await signedInAs(app, auth, "office");
});

const send = (
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: object,
) =>
  app.inject({
    method,
    url,
    headers: { cookie },
    ...(payload ? { payload } : {}),
  });

async function created(body: object) {
  const response = await send("POST", "/api/suppliers", body);
  expect(response.statusCode, response.body).toBe(201);
  return Supplier.parse(response.json());
}

async function list(query = "") {
  const response = await send("GET", `/api/suppliers${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return SupplierPage.parse(response.json());
}

const names = (page: SupplierPage) => page.items.map((s) => s.name);

// B00123455: worked out in packages/shared/src/tax-id.test.ts.
const HUERTO = { name: "Frutas del Huerto, S.L.", taxId: "B00123455" };

describe("POST /api/suppliers", () => {
  it("creates one with its contact: 201", async () => {
    const supplier = await created({
      ...HUERTO,
      contactName: "Lucía Ferrer",
      email: "pedidos@huerto.example",
      phone: "+34 900 000 000",
    });
    expect(supplier).toEqual({
      id: expect.any(String),
      ...HUERTO,
      contactName: "Lucía Ferrer",
      email: "pedidos@huerto.example",
      phone: "+34 900 000 000",
      active: true,
    });
  });

  it("keeps the tax ID in one form: upper case, no separators, no ES prefix", async () => {
    expect((await created({ ...HUERTO, taxId: "es-b00.123.455" })).taxId).toBe(
      "B00123455",
    );
  });

  it("a contact is optional: missing or blank, it's none", async () => {
    expect(await created({ ...HUERTO, email: "", phone: "  " })).toMatchObject({
      contactName: null,
      email: null,
      phone: null,
    });
  });

  it.each([
    [{ ...HUERTO, taxId: "B00123456" }, { taxId: "invalid_tax_id" }],
    [{ ...HUERTO, taxId: "FR12345678901" }, { taxId: "invalid_tax_id" }],
    [{ name: HUERTO.name }, { taxId: "required" }],
    [{ ...HUERTO, email: "pedidos at huerto" }, { email: "invalid" }],
    [{ ...HUERTO, phone: "call me" }, { phone: "invalid" }],
    [{ ...HUERTO, name: "" }, { name: "required" }],
  ])("refuses %j, naming the field: 400", async (body, fields) => {
    const response = await send("POST", "/api/suppliers", body);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_input", fields });
  });

  it("a tax ID another supplier has, however it's written, is a conflict: 409", async () => {
    await created(HUERTO);
    const response = await send("POST", "/api/suppliers", {
      name: "Huerto (otra cuenta)",
      taxId: "ESB-00123455",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "conflict",
      fields: { taxId: "taken" },
    });
    expect((await list("?status=all")).total).toBe(1);
  });

  it("two suppliers may share a name: only the tax ID is unique", async () => {
    await created(HUERTO);
    await created({ ...HUERTO, taxId: syntheticCif(1) });
    expect((await list()).total).toBe(2);
  });
});

describe("GET /api/suppliers", () => {
  it("lists the active ones by name, in Spanish order", async () => {
    await created({ name: "Pescados del Norte, S.L.", taxId: syntheticCif(1) });
    await created({ name: "Ámbar Bebidas, S.L.", taxId: syntheticCif(2) });
    await created({ name: "lácteos La Pradera, S.A.", taxId: syntheticCif(3) });
    expect(names(await list())).toEqual([
      "Ámbar Bebidas, S.L.",
      "lácteos La Pradera, S.A.",
      "Pescados del Norte, S.L.",
    ]);
  });

  it("q finds a supplier by its name, or by its tax ID however it's typed", async () => {
    await created(HUERTO);
    await created({ name: "Pescados del Norte, S.L.", taxId: syntheticCif(1) });
    expect(names(await list("?q=HUERTO"))).toEqual([HUERTO.name]);
    expect(names(await list("?q=b-00.123"))).toEqual([HUERTO.name]);
    expect(names(await list(`?q=${syntheticCif(1).toLowerCase()}`))).toEqual([
      "Pescados del Norte, S.L.",
    ]);
    // Only separators: nothing to look for in a tax ID, so nothing matches it.
    expect(names(await list("?q=-"))).toEqual([]);
  });

  it("status and pages, as for every list", async () => {
    for (let n = 1; n <= 3; n++) {
      await created({ name: `Proveedor ${n}`, taxId: syntheticCif(n) });
    }
    const [first] = (await list()).items;
    await send("PATCH", `/api/suppliers/${first!.id}`, { active: false });
    expect(await list("?pageSize=1&page=2")).toMatchObject({
      items: [{ name: "Proveedor 3" }],
      total: 2,
    });
    expect(names(await list("?status=inactive"))).toEqual(["Proveedor 1"]);
  });
});

describe("GET /api/suppliers/:id", () => {
  it("answers with the supplier, or 404", async () => {
    const huerto = await created(HUERTO);
    const found = await send("GET", `/api/suppliers/${huerto.id}`);
    expect(Supplier.parse(found.json())).toEqual(huerto);

    const missing = await send(
      "GET",
      "/api/suppliers/0199a000-0000-7000-8000-000000000000",
    );
    expect(missing.statusCode).toBe(404);
  });
});

describe("PATCH /api/suppliers/:id", () => {
  it("changes only the fields it's sent; null or blank clears a contact field", async () => {
    const huerto = await created({
      ...HUERTO,
      contactName: "Lucía Ferrer",
      email: "pedidos@huerto.example",
    });
    const response = await send("PATCH", `/api/suppliers/${huerto.id}`, {
      email: null,
      phone: "+34 900 000 001",
    });
    expect(response.statusCode).toBe(200);
    expect(Supplier.parse(response.json())).toEqual({
      ...huerto,
      email: null,
      phone: "+34 900 000 001",
    });
  });

  it("a new tax ID is checked and normalized like a new supplier's", async () => {
    const huerto = await created(HUERTO);
    const refused = await send("PATCH", `/api/suppliers/${huerto.id}`, {
      taxId: "B00123456",
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toEqual({
      error: "invalid_input",
      fields: { taxId: "invalid_tax_id" },
    });

    const changed = await send("PATCH", `/api/suppliers/${huerto.id}`, {
      taxId: syntheticCif(7).toLowerCase(),
    });
    expect(Supplier.parse(changed.json()).taxId).toBe(syntheticCif(7));
  });

  it("another supplier's tax ID: 409", async () => {
    await created(HUERTO);
    const other = await created({ name: "Otro", taxId: syntheticCif(1) });
    const response = await send("PATCH", `/api/suppliers/${other.id}`, {
      taxId: HUERTO.taxId,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "conflict",
      fields: { taxId: "taken" },
    });
  });
});
