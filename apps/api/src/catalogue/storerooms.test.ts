import { Storeroom, StoreroomPage } from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { storerooms, users } from "../db/schema";
import { signedInAs } from "../test/auth";
import { testConfig } from "../test/helpers";

// Storerooms (#88): where stock is kept. Who may call each route is in access.test.ts, and what
// each write records in the audit log is in src/audit/writes-audited.test.ts.

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
  await db.execute(
    sql`truncate ${users}, ${storerooms}, verifications cascade`,
  );
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
  const response = await send("POST", "/api/storerooms", body);
  expect(response.statusCode, response.body).toBe(201);
  return Storeroom.parse(response.json());
}

async function list(query = "") {
  const response = await send("GET", `/api/storerooms${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return StoreroomPage.parse(response.json());
}

const names = (page: StoreroomPage) => page.items.map((s) => s.name);

describe("GET /api/storerooms", () => {
  it("lists the active ones in Spanish order: case and accents don't move a name", async () => {
    for (const [name, type] of [
      ["Cámara frigorífica", "cold_room"],
      ["barra", "bar"],
      ["Almacén seco", "dry_store"],
      ["Bodega", "dry_store"],
    ] as const) {
      await created({ name, type });
    }
    expect(await list()).toEqual({
      items: [
        expect.objectContaining({ name: "Almacén seco", type: "dry_store" }),
        expect.objectContaining({ name: "barra", type: "bar" }),
        expect.objectContaining({ name: "Bodega", active: true }),
        expect.objectContaining({ name: "Cámara frigorífica" }),
      ],
      total: 4,
      page: 1,
      pageSize: 50,
    });
  });

  it("q finds a storeroom by any part of its name, whatever the case and accents", async () => {
    await created({ name: "Cámara frigorífica", type: "cold_room" });
    await created({ name: "Almacén seco", type: "dry_store" });
    expect(names(await list("?q=FRIGORIFICA"))).toEqual(["Cámara frigorífica"]);
    expect(names(await list("?q=almacen"))).toEqual(["Almacén seco"]);
    expect(names(await list("?q=%20%20"))).toHaveLength(2);
    expect(names(await list("?q=bodega"))).toEqual([]);
  });

  it("q means what it says: % and _ are characters, not wildcards", async () => {
    await created({ name: "Almacén 100% seco", type: "dry_store" });
    await created({ name: "Barra_1", type: "bar" });
    await created({ name: "Cámara", type: "cold_room" });
    expect(names(await list("?q=%25"))).toEqual(["Almacén 100% seco"]);
    expect(names(await list("?q=_"))).toEqual(["Barra_1"]);
  });

  it("type keeps only that type", async () => {
    await created({ name: "Barra", type: "bar" });
    await created({ name: "Terraza", type: "bar" });
    await created({ name: "Cámara", type: "cold_room" });
    expect(await list("?type=bar")).toMatchObject({
      items: [{ name: "Barra" }, { name: "Terraza" }],
      total: 2,
    });
  });

  it("status: the active ones by default, or the inactive ones, or all", async () => {
    await created({ name: "Barra", type: "bar" });
    const old = await created({ name: "Bodega vieja", type: "dry_store" });
    await send("PATCH", `/api/storerooms/${old.id}`, { active: false });

    expect(names(await list())).toEqual(["Barra"]);
    expect(names(await list("?status=inactive"))).toEqual(["Bodega vieja"]);
    expect(names(await list("?status=all"))).toEqual(["Barra", "Bodega vieja"]);
  });

  it("a page at a time, with the total the filters match", async () => {
    for (const name of ["A", "B", "C", "D", "E"]) {
      await created({ name, type: name < "D" ? "bar" : "dry_store" });
    }
    expect(await list("?pageSize=2&page=2")).toMatchObject({
      items: [{ name: "C" }, { name: "D" }],
      total: 5,
      page: 2,
      pageSize: 2,
    });
    expect(names(await list("?pageSize=2&page=3"))).toEqual(["E"]);
    expect(await list("?type=bar&pageSize=1")).toMatchObject({
      items: [{ name: "A" }],
      total: 3,
    });
  });

  it("refuses a query it can't read, naming each field: 400", async () => {
    const response = await send(
      "GET",
      "/api/storerooms?pageSize=0&type=freezer&status=gone",
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { pageSize: "too_small", type: "invalid", status: "invalid" },
    });
  });
});

describe("GET /api/storerooms/:id", () => {
  it("answers with the storeroom", async () => {
    const barra = await created({ name: "Barra", type: "bar" });
    const response = await send("GET", `/api/storerooms/${barra.id}`);
    expect(response.statusCode).toBe(200);
    expect(Storeroom.parse(response.json())).toEqual(barra);
  });

  it("one that doesn't exist: 404", async () => {
    const response = await send(
      "GET",
      "/api/storerooms/0199a000-0000-7000-8000-000000000000",
    );
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
  });

  it("an ID that isn't one: 400, naming it", async () => {
    const response = await send("GET", "/api/storerooms/barra");
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { id: "invalid" },
    });
  });
});

describe("POST /api/storerooms", () => {
  it("creates one, active, with the name trimmed: 201", async () => {
    const storeroom = await created({
      name: "  Cámara frigorífica ",
      type: "cold_room",
    });
    expect(storeroom).toEqual({
      id: expect.any(String),
      name: "Cámara frigorífica",
      type: "cold_room",
      active: true,
    });
    expect(names(await list())).toEqual(["Cámara frigorífica"]);
  });

  it.each([
    [{}, { name: "required", type: "required" }],
    [
      { name: "   ", type: "freezer" },
      { name: "required", type: "invalid" },
    ],
    [{ name: "x".repeat(101), type: "bar" }, { name: "too_long" }],
    [{ name: 7, type: "bar" }, { name: "invalid" }],
    [
      { name: "Barra", type: "bar", colour: "red" },
      { colour: "unknown_field" },
    ],
  ])("refuses %j, naming each field: 400", async (body, fields) => {
    const response = await send("POST", "/api/storerooms", body);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_input", fields });
    expect((await list("?status=all")).total).toBe(0);
  });

  it("a name already taken, in any case, is a conflict: 409, and nothing is added", async () => {
    await created({ name: "Barra", type: "bar" });
    const response = await send("POST", "/api/storerooms", {
      name: "BARRA",
      type: "dry_store",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "conflict",
      fields: { name: "taken" },
    });
    expect((await list("?status=all")).total).toBe(1);
  });
});

describe("PATCH /api/storerooms/:id", () => {
  it("changes only the fields it's sent", async () => {
    const barra = await created({ name: "Barra", type: "bar" });
    const response = await send("PATCH", `/api/storerooms/${barra.id}`, {
      type: "dry_store",
    });
    expect(response.statusCode).toBe(200);
    expect(Storeroom.parse(response.json())).toEqual({
      ...barra,
      type: "dry_store",
    });

    const renamed = await send("PATCH", `/api/storerooms/${barra.id}`, {
      name: "Barra principal",
    });
    expect(Storeroom.parse(renamed.json())).toEqual({
      ...barra,
      name: "Barra principal",
      type: "dry_store",
    });
  });

  it("deactivates one, which can still be read, and reactivates it", async () => {
    const barra = await created({ name: "Barra", type: "bar" });
    const off = await send("PATCH", `/api/storerooms/${barra.id}`, {
      active: false,
    });
    expect(Storeroom.parse(off.json()).active).toBe(false);
    expect(names(await list())).toEqual([]);
    expect(
      Storeroom.parse((await send("GET", `/api/storerooms/${barra.id}`)).json())
        .active,
    ).toBe(false);

    await send("PATCH", `/api/storerooms/${barra.id}`, { active: true });
    expect(names(await list())).toEqual(["Barra"]);
  });

  it("an empty change changes nothing", async () => {
    const barra = await created({ name: "Barra", type: "bar" });
    const response = await send("PATCH", `/api/storerooms/${barra.id}`, {});
    expect(response.statusCode).toBe(200);
    expect(Storeroom.parse(response.json())).toEqual(barra);
  });

  it("one that doesn't exist: 404", async () => {
    const response = await send(
      "PATCH",
      "/api/storerooms/0199a000-0000-7000-8000-000000000000",
      { name: "Barra" },
    );
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "not_found" });
  });

  it("a name another storeroom has: 409, and nothing changes", async () => {
    await created({ name: "Barra", type: "bar" });
    const bodega = await created({ name: "Bodega", type: "dry_store" });
    const response = await send("PATCH", `/api/storerooms/${bodega.id}`, {
      name: "barra",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "conflict",
      fields: { name: "taken" },
    });
    expect(names(await list())).toEqual(["Barra", "Bodega"]);
  });

  it("refuses a field it can't take, naming it: 400", async () => {
    const barra = await created({ name: "Barra", type: "bar" });
    const response = await send("PATCH", `/api/storerooms/${barra.id}`, {
      name: "",
      active: "no",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_input",
      fields: { name: "required", active: "invalid" },
    });
  });
});
