import {
  endpoints,
  MeResponse,
  Storeroom,
  Supplier,
} from "@kitchen-ops/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { auditLog, storerooms, suppliers, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";

// Every write endpoint records its changes in the audit log (#87). A new write endpoint fails
// the first test until it has a case here: the audit log can't be forgotten.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config);
afterAll(async () => {
  await app.close();
  await close();
});

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${storerooms}, ${suppliers}, verifications cascade`,
  );
});

const entriesFor = (entityType: string, entityId: string) =>
  db
    .select()
    .from(auditLog)
    .where(
      and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)),
    );

const allEntries = (entityType: string) =>
  db.select().from(auditLog).where(eq(auditLog.entityType, entityType));

const updatesOf = (entityType: string, entityId: string) =>
  db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, entityType),
        eq(auditLog.entityId, entityId),
        eq(auditLog.action, "update"),
      ),
    );

/** A signed-in office user: its ID, and a way to call the API as it. */
async function officeUser() {
  const cookie = await signedInAs(app, auth, "office");
  const me = MeResponse.parse(
    (
      await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })
    ).json(),
  );
  return {
    id: me.id,
    send: (method: "POST" | "PATCH", url: string, payload: object) =>
      app.inject({ method, url, headers: { cookie }, payload }),
  };
}

/**
 * One case per write endpoint, by its name in the contract: it makes the write, checks the
 * one entry each change records, and checks that a refused write, or one that changes
 * nothing, records none.
 */
const WRITE_CASES: Record<string, () => Promise<void>> = {
  async updateMe() {
    const cookie = await signedInAs(app, auth, "counter");
    const patch = (locale: string) =>
      app.inject({
        method: "PATCH",
        url: "/api/me",
        headers: { cookie },
        payload: { locale },
      });
    const me = MeResponse.parse(
      (
        await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })
      ).json(),
    );

    const changed = await patch("en");
    expect(changed.statusCode).toBe(200);
    expect(await entriesFor("user", me.id)).toEqual([
      expect.objectContaining({
        userId: me.id,
        action: "update",
        requestId: changed.headers["x-request-id"],
        documentId: null,
        changes: { locale: { before: "es", after: "en" } },
      }),
    ]);

    // The same language again changes nothing, so it records nothing.
    expect((await patch("en")).statusCode).toBe(200);
    // Refused: nothing written, nothing recorded.
    expect((await patch("fr")).statusCode).toBe(400);
    expect(await entriesFor("user", me.id)).toHaveLength(1);
  },

  async createStoreroom() {
    const office = await officeUser();
    const create = (body: object) =>
      office.send("POST", "/api/storerooms", body);

    const response = await create({ name: "Barra", type: "bar" });
    expect(response.statusCode).toBe(201);
    const barra = Storeroom.parse(response.json());
    expect(await entriesFor("storeroom", barra.id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        changes: {
          id: { before: null, after: barra.id },
          name: { before: null, after: "Barra" },
          type: { before: null, after: "bar" },
          active: { before: null, after: true },
        },
      }),
    ]);

    // Refused, invalid or taken: nothing added, nothing recorded.
    expect((await create({ name: "Bodega" })).statusCode).toBe(400);
    expect((await create({ name: "barra", type: "bar" })).statusCode).toBe(409);
    expect(await allEntries("storeroom")).toHaveLength(1);
  },

  async updateStoreroom() {
    const office = await officeUser();
    const barra = Storeroom.parse(
      (
        await office.send("POST", "/api/storerooms", {
          name: "Barra",
          type: "bar",
        })
      ).json(),
    );
    await office.send("POST", "/api/storerooms", {
      name: "Bodega",
      type: "dry_store",
    });
    const update = (body: object, id = barra.id) =>
      office.send("PATCH", `/api/storerooms/${id}`, body);

    const response = await update({ name: "Barra principal", type: "bar" });
    expect(response.statusCode).toBe(200);
    expect(await updatesOf("storeroom", barra.id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        requestId: response.headers["x-request-id"],
        // Only what changed: the type was sent, but it was already "bar".
        changes: { name: { before: "Barra", after: "Barra principal" } },
      }),
    ]);

    // The same values again, an empty change, invalid, taken, or no such storeroom: nothing.
    expect((await update({ name: "Barra principal" })).statusCode).toBe(200);
    expect((await update({})).statusCode).toBe(200);
    expect((await update({ name: "" })).statusCode).toBe(400);
    expect((await update({ name: "Bodega" })).statusCode).toBe(409);
    expect(
      (await update({ active: false }, "0199a000-0000-7000-8000-000000000000"))
        .statusCode,
    ).toBe(404);
    expect(await updatesOf("storeroom", barra.id)).toHaveLength(1);
  },

  async createSupplier() {
    const office = await officeUser();
    const create = (body: object) =>
      office.send("POST", "/api/suppliers", body);

    const response = await create({
      name: "Frutas del Huerto, S.L.",
      taxId: "b-00.123.455",
      email: "pedidos@huerto.example",
    });
    expect(response.statusCode).toBe(201);
    const huerto = Supplier.parse(response.json());
    expect(await entriesFor("supplier", huerto.id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        changes: {
          id: { before: null, after: huerto.id },
          name: { before: null, after: "Frutas del Huerto, S.L." },
          taxId: { before: null, after: "B00123455" },
          // contactName and phone are left out: created empty, they didn't change.
          email: { before: null, after: "pedidos@huerto.example" },
          active: { before: null, after: true },
        },
      }),
    ]);

    expect(
      (await create({ name: "Otro", taxId: "B00123456" })).statusCode,
    ).toBe(400);
    expect(
      (await create({ name: "Otro", taxId: "B00123455" })).statusCode,
    ).toBe(409);
    expect(await allEntries("supplier")).toHaveLength(1);
  },

  async updateSupplier() {
    const office = await officeUser();
    const huerto = Supplier.parse(
      (
        await office.send("POST", "/api/suppliers", {
          name: "Frutas del Huerto, S.L.",
          taxId: "B00123455",
          email: "pedidos@huerto.example",
        })
      ).json(),
    );
    await office.send("POST", "/api/suppliers", {
      name: "Otro",
      taxId: syntheticCif(1),
    });
    const update = (body: object) =>
      office.send("PATCH", `/api/suppliers/${huerto.id}`, body);

    const response = await update({ email: null, taxId: syntheticCif(2) });
    expect(response.statusCode).toBe(200);
    expect(await updatesOf("supplier", huerto.id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        requestId: response.headers["x-request-id"],
        changes: {
          taxId: { before: "B00123455", after: syntheticCif(2) },
          email: { before: "pedidos@huerto.example", after: null },
        },
      }),
    ]);

    expect((await update({ email: null })).statusCode).toBe(200);
    expect((await update({ taxId: "B00123456" })).statusCode).toBe(400);
    expect((await update({ taxId: syntheticCif(1) })).statusCode).toBe(409);
    expect(await updatesOf("supplier", huerto.id)).toHaveLength(1);
  },
};

describe("every write is in the audit log (#87)", () => {
  it("every write endpoint in the contract has an audit case here", () => {
    const writes = Object.entries(endpoints)
      .filter(([, endpoint]) => endpoint.method !== "GET")
      .map(([name]) => name)
      .sort();
    expect(
      Object.keys(WRITE_CASES).sort(),
      "each write endpoint needs a case in WRITE_CASES",
    ).toEqual(writes);
  });

  for (const [name, check] of Object.entries(WRITE_CASES)) {
    it(
      `${name}: one entry per change; none for a refused write or one that changes nothing`,
      check,
    );
  }
});
