import { randomUUIDv7 } from "node:crypto";
import {
  DocumentPosting,
  MeResponse,
  Product,
  ProductMovementPage,
  ProductPage,
  StockPage,
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

// Stock per storeroom (#150): every product in every storeroom it has moved through, valued at
// its average cost for office and the owner, and the movements behind a product's stock. Counter
// users see quantities, never euros: the API leaves them out.

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
let huerto: Supplier;
let tomate: Product;
let aceite: Product;
let limon: Product;
/** 10 kg of tomatoes at €1.80/kg and 2 kg of lemons at €3.00/kg into the cold room, 10 l of oil at €4.90/l into the dry store. */
let first: string;
/** 5 kg more tomatoes, at €2.40/kg: their average is €2.00/kg. */
let second: string;
/** 4 kg of tomatoes from the cold room to the dry store, at €2.00/kg. */
let moved: string;

/** Posts a delivery note from El Huerto, into the cold room unless a line says otherwise. */
async function deliver(number: string, date: string, lines: ReviewedLine[]) {
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
      date,
      storeroomId: coldRoom.id,
      lines,
    },
  );
  expect(posted.ok).toBe(true);
  return id;
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
  huerto = await office.created(
    "/api/suppliers",
    { name: "Frutas El Huerto, S.L.", taxId: syntheticCif(12) },
    Supplier,
  );
  const product = (name: string, baseUnit: string, category: string) =>
    office.created(
      "/api/products",
      {
        name,
        baseUnit,
        category,
        conversions: [{ unit: baseUnit === "g" ? "kg" : "l", factor: 1000 }],
      },
      Product,
    );
  tomate = await product("Tomate pera", "g", "produce");
  aceite = await product("Aceite de oliva virgen extra", "ml", "dry_goods");
  limon = await product("Limón", "g", "produce");
  // Never received: it has no stock to list.
  await product("Sal en escamas", "g", "dry_goods");

  first = await deliver("A-1", "2026-10-20", [
    reviewedLine(tomate.id, "10", "kg", "1.80"),
    reviewedLine(aceite.id, "10", "l", "4.90", { storeroomId: dryStore.id }),
    reviewedLine(limon.id, "2", "kg", "3.00"),
  ]);
  second = await deliver("A-2", "2026-10-21", [
    reviewedLine(tomate.id, "5", "kg", "2.40"),
  ]);
  moved = randomUUIDv7();
  const transfer = await office.send("PUT", `/api/transfers/${moved}`, {
    storeroomId: coldRoom.id,
    toStoreroomId: dryStore.id,
    lines: [{ productId: tomate.id, quantity: "4", unit: "kg" }],
  });
  expect(transfer.statusCode, transfer.body).toBe(200);
});

const stock = (api: ReturnType<typeof apiAs>, query = "") =>
  api.read(`/api/stock${query}`, StockPage);
const placesOf = (page: StockPage) =>
  page.items.map((p) => `${p.product.name} / ${p.storeroom.name}`);

describe("GET /api/stock", () => {
  it("office sees every product in every storeroom it has moved through, by name and then storeroom, with its stock, average cost and value, and each storeroom's value and the total", async () => {
    const page = await stock(office);
    expect(page).toEqual({
      items: [
        {
          product: {
            id: aceite.id,
            name: "Aceite de oliva virgen extra",
            baseUnit: "ml",
            category: "dry_goods",
          },
          storeroom: { id: dryStore.id, name: "Almacén" },
          onHand: 10_000,
          averageCost: "0.004900",
          // 10 000 ml × €0.0049
          value: "49.00",
        },
        {
          product: {
            id: limon.id,
            name: "Limón",
            baseUnit: "g",
            category: "produce",
          },
          storeroom: { id: coldRoom.id, name: "Cámara" },
          onHand: 2000,
          averageCost: "0.003000",
          value: "6.00",
        },
        {
          product: {
            id: tomate.id,
            name: "Tomate pera",
            baseUnit: "g",
            category: "produce",
          },
          storeroom: { id: dryStore.id, name: "Almacén" },
          onHand: 4000,
          // (10 000 × 0.0018 + 5000 × 0.0024) / 15 000, moved at that average
          averageCost: "0.002000",
          value: "8.00",
        },
        {
          product: {
            id: tomate.id,
            name: "Tomate pera",
            baseUnit: "g",
            category: "produce",
          },
          storeroom: { id: coldRoom.id, name: "Cámara" },
          onHand: 11_000,
          averageCost: "0.002000",
          value: "22.00",
        },
      ],
      total: 4,
      page: 1,
      pageSize: 50,
      totals: {
        storerooms: [
          // 49.00 + 8.00
          { storeroom: { id: dryStore.id, name: "Almacén" }, value: "57.00" },
          // 6.00 + 22.00
          { storeroom: { id: coldRoom.id, name: "Cámara" }, value: "28.00" },
        ],
        value: "85.00",
      },
    });
    expect(await stock(owner)).toEqual(page);
  });

  it("a counter user sees the same stock without a euro in the answer: no cost, value or totals", async () => {
    const response = await counter.send("GET", "/api/stock");
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toMatch(/averageCost|value|totals/);
    const page = StockPage.parse(response.json());
    expect(page.items.map((p) => p.onHand)).toEqual([
      10_000, 2000, 4000, 11_000,
    ]);
    expect(page.totals).toBeUndefined();
  });

  it("searches product names whatever their case and accents; the totals stay the whole stock's", async () => {
    const lemons = await stock(office, "?q=limon");
    expect(placesOf(lemons)).toEqual(["Limón / Cámara"]);
    expect(lemons.total).toBe(1);
    expect(lemons.totals?.value).toBe("85.00");
    expect(placesOf(await stock(office, "?q=TOMATE"))).toEqual([
      "Tomate pera / Almacén",
      "Tomate pera / Cámara",
    ]);
    // A wildcard means itself.
    expect((await stock(office, "?q=%25")).items).toEqual([]);
  });

  it("filters by storeroom and by category", async () => {
    expect(
      placesOf(await stock(office, `?storeroomId=${dryStore.id}`)),
    ).toEqual([
      "Aceite de oliva virgen extra / Almacén",
      "Tomate pera / Almacén",
    ]);
    expect(placesOf(await stock(office, "?category=produce"))).toEqual([
      "Limón / Cámara",
      "Tomate pera / Almacén",
      "Tomate pera / Cámara",
    ]);
    expect(
      placesOf(
        await stock(office, `?category=produce&storeroomId=${dryStore.id}`),
      ),
    ).toEqual(["Tomate pera / Almacén"]);
  });

  it("filters by product: its stock in each storeroom, for its own page", async () => {
    const tomatoes = await stock(office, `?productId=${tomate.id}`);
    expect(placesOf(tomatoes)).toEqual([
      "Tomate pera / Almacén",
      "Tomate pera / Cámara",
    ]);
    expect(
      placesOf(
        await stock(
          office,
          `?productId=${tomate.id}&storeroomId=${coldRoom.id}`,
        ),
      ),
    ).toEqual(["Tomate pera / Cámara"]);
    expect((await stock(office, `?productId=${MISSING}`)).items).toEqual([]);
  });

  it("answers a page at a time, with the total of every place the filters match", async () => {
    const page = await stock(office, "?page=2&pageSize=3");
    expect(placesOf(page)).toEqual(["Tomate pera / Cámara"]);
    expect(page).toMatchObject({ total: 4, page: 2, pageSize: 3 });
  });

  it("a product whose stock is all gone stays listed, at 0 and worth €0.00", async () => {
    const response = await office.send("PUT", `/api/waste/${randomUUIDv7()}`, {
      storeroomId: coldRoom.id,
      reason: "spoiled",
      lines: [{ productId: limon.id, quantity: "2", unit: "kg" }],
    });
    expect(response.statusCode, response.body).toBe(200);
    const lemons = (await stock(office, "?q=limon")).items[0]!;
    expect(lemons).toMatchObject({
      onHand: 0,
      averageCost: "0.003000",
      value: "0.00",
    });
    expect((await stock(office)).totals?.value).toBe("79.00");
  });

  it("refuses a page too large and a category not on the list", async () => {
    expect(
      (await office.send("GET", "/api/stock?pageSize=500")).statusCode,
    ).toBe(400);
    expect(
      (await office.send("GET", "/api/stock?category=gadgets")).statusCode,
    ).toBe(400);
  });
});

const movementsOf = (
  api: ReturnType<typeof apiAs>,
  productId: string,
  query = "",
) =>
  api.read(`/api/products/${productId}/movements${query}`, ProductMovementPage);

describe("GET /api/products/:id/movements", () => {
  it("newest first, each with its kind, storeroom, quantity, cost, its document's date, and its document", async () => {
    const page = await movementsOf(office, tomate.id);
    expect(page).toMatchObject({ total: 4, page: 1, pageSize: 50 });
    const transfer = {
      id: moved,
      type: "transfer",
      number: null,
      reverses: null,
    };
    expect(page.items).toMatchObject([
      {
        kind: "transfer-in",
        storeroom: { id: dryStore.id, name: "Almacén" },
        quantity: 4000,
        unitCost: "0.002000",
        adjustment: false,
        document: transfer,
      },
      {
        kind: "transfer-out",
        storeroom: { id: coldRoom.id, name: "Cámara" },
        quantity: -4000,
        unitCost: "0.002000",
        document: transfer,
      },
      {
        kind: "receipt",
        storeroom: { id: coldRoom.id },
        quantity: 5000,
        unitCost: "0.002400",
        date: "2026-10-21",
        document: {
          id: second,
          type: "delivery-note",
          number: "A-2",
          reverses: null,
        },
      },
      {
        kind: "receipt",
        quantity: 10_000,
        unitCost: "0.001800",
        date: "2026-10-20",
        document: { id: first, number: "A-1" },
      },
    ]);
  });

  it("a counter user sees the movements without their cost", async () => {
    const response = await counter.send(
      "GET",
      `/api/products/${tomate.id}/movements`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toMatch(/unitCost/);
    expect(
      ProductMovementPage.parse(response.json()).items.map((m) => m.quantity),
    ).toEqual([4000, -4000, 5000, 10_000]);
  });

  it("filters by storeroom, and answers a page at a time", async () => {
    const cold = await movementsOf(
      office,
      tomate.id,
      `?storeroomId=${coldRoom.id}`,
    );
    expect(cold.items.map((m) => m.quantity)).toEqual([-4000, 5000, 10_000]);
    const paged = await movementsOf(office, tomate.id, "?page=2&pageSize=1");
    expect(paged.items.map((m) => m.kind)).toEqual(["transfer-out"]);
    expect(paged.total).toBe(4);
  });

  it("a reversal's movement names the document it reverses, which is the page that shows both", async () => {
    const reversed = await owner.send(
      "POST",
      `/api/documents/${second}/reverse`,
    );
    expect(reversed.statusCode, reversed.body).toBe(200);
    const reversal = DocumentPosting.parse(reversed.json()).reversal!;
    const [newest] = (await movementsOf(office, tomate.id)).items;
    expect(newest).toMatchObject({
      kind: "receipt",
      quantity: -5000,
      document: {
        id: reversal.id,
        type: "delivery-note",
        number: "A-2",
        reverses: second,
      },
    });
  });

  it("a product with no movements has none; one that doesn't exist is not found", async () => {
    const sal = (await office.read("/api/products?q=sal", ProductPage))
      .items[0]!;
    expect((await movementsOf(office, sal.id)).items).toEqual([]);
    expect(
      (await office.send("GET", `/api/products/${MISSING}/movements`))
        .statusCode,
    ).toBe(404);
  });
});
