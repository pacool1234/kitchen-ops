import { randomUUIDv7 } from "node:crypto";
import {
  CountSheet,
  MeResponse,
  Product,
  Storeroom,
  Supplier,
} from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import {
  documentFiles,
  documents,
  products,
  storerooms,
  suppliers,
  users,
} from "../db/schema";
import { postDocument, type ReviewedLine } from "../posting/posting";
import { createMemoryStorage } from "../storage/memory";
import { signedInAs, signedInAsOwner } from "../test/auth";
import { apiAs, syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";
import { reviewedLine } from "../test/posting";

// A storeroom's count sheet (#152): what a count of it lists to begin with, the products with
// stock there and those whose default storeroom it is, in the same order every time, each with
// its units. It says nothing of how much there is: a count is blind, for every role.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config, { storage: createMemoryStorage() });
afterAll(async () => {
  await app.close();
  await close();
});

const MISSING = "0199a000-0000-7000-8000-000000000000";

let office: ReturnType<typeof apiAs>;
let officeId: string;
let counter: ReturnType<typeof apiAs>;
let owner: ReturnType<typeof apiAs>;
let coldRoom: Storeroom;
let dryStore: Storeroom;
let bar: Storeroom;
let huerto: Supplier;
let tomate: Product;

/** Posts a delivery note from El Huerto, into the cold room unless a line says otherwise. */
async function deliver(number: string, lines: ReviewedLine[]) {
  const [row] = await db
    .insert(documents)
    .values({ status: "ready_for_review", uploadedBy: officeId })
    .returning({ id: documents.id });
  const id = row!.id;
  await db.insert(documentFiles).values({
    documentId: id,
    position: 1,
    kind: "image",
    contentType: "image/jpeg",
    sizeBytes: 1,
    sha256: id,
    storageKey: `documents/${id}/1.jpg`,
  });
  const posted = await postDocument(
    db,
    { userId: officeId, requestId: "test" },
    id,
    {
      type: "delivery-note",
      supplierId: huerto.id,
      number,
      date: "2026-10-20",
      storeroomId: coldRoom.id,
      lines,
    },
  );
  expect(posted.ok).toBe(true);
}

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${documents}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
  );
  office = apiAs(app, await signedInAs(app, auth, "office"));
  officeId = (await office.read("/api/me", MeResponse)).id;
  counter = apiAs(app, await signedInAs(app, auth, "counter"));
  owner = apiAs(app, await signedInAsOwner(app, auth));
  const storeroom = (name: string, type: string) =>
    office.created("/api/storerooms", { name, type }, Storeroom);
  coldRoom = await storeroom("Cámara", "cold_room");
  dryStore = await storeroom("Almacén", "dry_store");
  bar = await storeroom("Barra", "bar");
  huerto = await office.created(
    "/api/suppliers",
    { name: "Frutas El Huerto, S.L.", taxId: syntheticCif(13) },
    Supplier,
  );
  const product = (
    name: string,
    category: string,
    more: {
      baseUnit?: string;
      defaultStoreroomId?: string;
      conversions?: object[];
    } = {},
  ) =>
    office.created(
      "/api/products",
      { name, baseUnit: "g", category, ...more },
      Product,
    );

  // With stock in the cold room.
  tomate = await product("Tomate pera", "produce", {
    conversions: [
      { unit: "kg", factor: 1000 },
      { unit: "caja", factor: 6000 },
    ],
  });
  const merluza = await product("Merluza", "fish");
  const nata = await product("Nata para cocinar", "dairy", { baseUnit: "ml" });
  // In the cold room once, all of it gone since.
  const limon = await product("Limón", "produce");
  // With stock in the dry store only.
  const aceite = await product("Aceite de oliva", "dry_goods", {
    baseUnit: "ml",
  });
  // The cold room is their default storeroom, and they've never come in.
  await product("Lechuga", "produce", {
    baseUnit: "unit",
    defaultStoreroomId: coldRoom.id,
  });
  await product("Ajo morado", "produce", { defaultStoreroomId: coldRoom.id });
  const azucar = await product("Azúcar", "dry_goods", {
    defaultStoreroomId: coldRoom.id,
  });

  await deliver("A-1", [
    reviewedLine(tomate.id, "10", "kg", "1.80"),
    reviewedLine(merluza.id, "2", "g", "0.012"),
    reviewedLine(nata.id, "1000", "ml", "0.004"),
    reviewedLine(limon.id, "500", "g", "0.003"),
    reviewedLine(aceite.id, "5000", "ml", "0.0049", {
      storeroomId: dryStore.id,
    }),
  ]);
  const wasted = await office.send("PUT", `/api/waste/${randomUUIDv7()}`, {
    storeroomId: coldRoom.id,
    reason: "spoiled",
    lines: [{ productId: limon.id, quantity: "500", unit: "g" }],
  });
  expect(wasted.statusCode, wasted.body).toBe(200);
  // No longer bought, but some is still there to count; one that's not used any more is left out.
  for (const p of [nata, azucar]) {
    await office.updated(`/api/products/${p.id}`, { active: false }, Product);
  }
});

const sheet = (storeroomId: string, api = office) =>
  api.read(`/api/storerooms/${storeroomId}/count-sheet`, CountSheet);

describe("GET /api/storerooms/:id/count-sheet", () => {
  it("lists the products with stock there and those it's the default storeroom of, by category, then name in Spanish order", async () => {
    const { storeroom, products: listed } = await sheet(coldRoom.id);
    expect(storeroom).toEqual({ id: coldRoom.id, name: "Cámara" });
    expect(listed.map((p) => p.name)).toEqual([
      // Produce, then fish, then dairy: the catalogue's categories, in order.
      "Ajo morado",
      "Lechuga",
      "Tomate pera",
      "Merluza",
      "Nata para cocinar",
    ]);
  });

  it("each with its units, to count it in kilos or in its boxes", async () => {
    const { products: listed } = await sheet(coldRoom.id);
    expect(listed.find((p) => p.id === tomate.id)).toEqual({
      ...tomate,
      conversions: [
        { unit: "kg", factor: 1000 },
        { unit: "caja", factor: 6000 },
      ],
    });
  });

  it("leaves out what's all gone, what's only elsewhere, and a default no longer in use; keeps one no longer bought that's still there", async () => {
    const names = (await sheet(coldRoom.id)).products.map((p) => p.name);
    expect(names).not.toContain("Limón");
    expect(names).not.toContain("Aceite de oliva");
    expect(names).not.toContain("Azúcar");
    expect(names).toContain("Nata para cocinar");
    expect((await sheet(dryStore.id)).products.map((p) => p.name)).toEqual([
      "Aceite de oliva",
    ]);
  });

  it("is blind: it says nothing of how much there is, for any role", async () => {
    for (const api of [counter, office, owner]) {
      const response = await api.send(
        "GET",
        `/api/storerooms/${coldRoom.id}/count-sheet`,
      );
      expect(response.statusCode, response.body).toBe(200);
      for (const word of ["onHand", "quantity", "averageCost", "value"]) {
        expect(response.body).not.toContain(word);
      }
    }
  });

  it("a storeroom with nothing in it and no products of its own: an empty sheet; an unknown one, 404", async () => {
    expect(await sheet(bar.id, counter)).toEqual({
      storeroom: { id: bar.id, name: "Barra" },
      products: [],
    });
    expect(
      (await office.send("GET", `/api/storerooms/${MISSING}/count-sheet`))
        .statusCode,
    ).toBe(404);
  });
});
