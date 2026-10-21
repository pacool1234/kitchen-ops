import { randomUUIDv7 } from "node:crypto";
import {
  DocumentPage,
  DocumentPosting,
  MeResponse,
  PostedStockDocument,
  Product,
  Storeroom,
  Supplier,
} from "@kitchen-ops/shared";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb, type Db } from "../db/client";
import {
  documentFiles,
  documents,
  movements,
  products,
  storerooms,
  suppliers,
  users,
} from "../db/schema";
import { today } from "../extraction/read";
import {
  databaseNow as readClock,
  postDocument,
  type ReviewedLine,
} from "../posting/posting";
import { createMemoryStorage } from "../storage/memory";
import { signedInAs, signedInAsOwner } from "../test/auth";
import { apiAs, syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";
import { reviewedLine } from "../test/posting";
import { recordStockDocument } from "./record";
import { productStock } from "./stock";

// Waste, transfers and counts (#149, decision 0044): recorded under an ID the client made, and
// posted at once, by any role. The same request sent again answers what was posted, and posts
// nothing more; another one under the same ID is refused.

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
let closed: Storeroom;
let huerto: Supplier;
/** In grams, by the kg: 10 kg in the cold room at €1.80/kg. */
let tomate: Product;
/** In ml, by the litre: 10 l in the dry store at €4.90/l. */
let aceite: Product;
/** The delivery note that brought them. */
let delivery: string;

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
  closed = await storeroom("Barra vieja", "bar");
  await office.updated(
    `/api/storerooms/${closed.id}`,
    { active: false },
    Storeroom,
  );
  huerto = await office.created(
    "/api/suppliers",
    { name: "Frutas El Huerto, S.L.", taxId: syntheticCif(11) },
    Supplier,
  );
  tomate = await office.created(
    "/api/products",
    {
      name: "Tomate pera",
      baseUnit: "g",
      category: "produce",
      conversions: [{ unit: "kg", factor: 1000 }],
    },
    Product,
  );
  aceite = await office.created(
    "/api/products",
    {
      name: "Aceite de oliva virgen extra",
      baseUnit: "ml",
      category: "dry_goods",
      conversions: [{ unit: "l", factor: 1000 }],
    },
    Product,
  );

  delivery = await deliver("A-1", [
    reviewedLine(tomate.id, "10", "kg", "1.80"),
    reviewedLine(aceite.id, "10", "l", "4.90", { storeroomId: dryStore.id }),
  ]);
});

/** Posts a delivery note from El Huerto into the cold room, and gives its ID. */
async function deliver(number: string, lines: ReviewedLine[]) {
  const [row] = await db
    .insert(documents)
    .values({ status: "ready_for_review", uploadedBy: officeId })
    .returning({ id: documents.id });
  const id = row!.id;
  // A supplier's document comes with its file, a photo here.
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
  return id;
}

/**
 * The database's clock, which stamps movements, to the millisecond: what a count's time is
 * compared with. It waits for the clock to move on, so what's posted next is stamped later.
 */
async function databaseNow() {
  const read = () => readClock(db);
  const now = await read();
  let later = await read();
  while (later.getTime() === now.getTime()) later = await read();
  return now;
}

const waste = (id: string, body: object, api = office) =>
  api.send("PUT", `/api/waste/${id}`, body);
const transfer = (id: string, body: object, api = office) =>
  api.send("PUT", `/api/transfers/${id}`, body);
const count = (id: string, body: object, api = office) =>
  api.send("PUT", `/api/counts/${id}`, body);

/** 2 kg of tomatoes from the cold room, spoiled. */
const SPOILED = () => ({
  storeroomId: coldRoom.id,
  reason: "spoiled",
  note: "Se rompió la cámara el fin de semana",
  lines: [{ productId: tomate.id, quantity: "2", unit: "kg" }],
});

/** 4 kg of tomatoes from the cold room to the dry store. */
const TO_DRY_STORE = () => ({
  storeroomId: coldRoom.id,
  toStoreroomId: dryStore.id,
  lines: [{ productId: tomate.id, quantity: "4", unit: "kg" }],
});

/** 7.5 kg of tomatoes in the cold room, counted at `countedAt`. */
const COUNTED = (countedAt: Date) => ({
  storeroomId: coldRoom.id,
  countedAt: countedAt.toISOString(),
  lines: [{ productId: tomate.id, quantity: "7.5", unit: "kg" }],
});

/** A product's stock in each storeroom, by storeroom ID. */
async function stockOf(productId: string) {
  const { storerooms: places } = (await productStock(db, productId))!;
  return Object.fromEntries(places.map((p) => [p.storeroom.id, p.onHand]));
}

const movementCount = async () =>
  (await db.select({ id: movements.id }).from(movements)).length;

async function expectRefused(
  response: Awaited<ReturnType<typeof waste>>,
  status: number,
  body: object,
) {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.json()).toEqual(body);
}

describe("PUT /api/waste/:id", () => {
  it("office records 2 kg of spoiled tomatoes: −2000 g from the cold room at its average, €0.001800/g, posted at once, with what, where and why", async () => {
    const id = randomUUIDv7();
    const response = await waste(id, SPOILED());
    expect(response.statusCode, response.body).toBe(200);
    const recorded = PostedStockDocument.parse(response.json());
    expect(recorded).toMatchObject({
      id,
      type: "waste",
      date: today(new Date()),
      storeroom: { id: coldRoom.id, name: "Cámara" },
      toStoreroom: null,
      reason: "spoiled",
      note: "Se rompió la cámara el fin de semana",
      countedAt: null,
      recordedBy: { id: officeId, name: "Test office" },
      reversal: null,
      lines: [
        {
          position: 1,
          product: { id: tomate.id, name: "Tomate pera", baseUnit: "g" },
          quantity: "2",
          unit: "kg",
          movements: [
            {
              storeroom: { id: coldRoom.id },
              quantity: -2000,
              unitCost: "0.001800",
              value: "-3.60",
              kind: "waste",
            },
          ],
        },
      ],
    });
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row).toMatchObject({
      status: "posted",
      type: "waste",
      storeroomId: coldRoom.id,
      toStoreroomId: null,
      wasteReason: "spoiled",
      note: "Se rompió la cámara el fin de semana",
      supplierId: null,
      date: today(new Date()),
      uploadedBy: officeId,
    });
    expect(row!.requestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await stockOf(tomate.id)).toEqual({ [coldRoom.id]: 8000 });
  });

  it("the same request sent again answers what was posted, and posts nothing more", async () => {
    const id = randomUUIDv7();
    const first = await waste(id, SPOILED());
    const moved = await movementCount();
    const again = await waste(id, SPOILED());
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(await movementCount()).toBe(moved);
    expect(await stockOf(tomate.id)).toEqual({ [coldRoom.id]: 8000 });
  });

  it("the same ID with another body is refused, 409 conflict; so is a supplier document's ID, or a transfer's", async () => {
    const id = randomUUIDv7();
    await waste(id, SPOILED());
    const moved = await movementCount();
    await expectRefused(
      await waste(id, {
        ...SPOILED(),
        lines: [{ productId: tomate.id, quantity: "3", unit: "kg" }],
      }),
      409,
      { error: "conflict" },
    );
    await expectRefused(await waste(delivery, SPOILED()), 409, {
      error: "conflict",
    });
    const moved2 = randomUUIDv7();
    await transfer(moved2, TO_DRY_STORE());
    await expectRefused(await waste(moved2, SPOILED()), 409, {
      error: "conflict",
    });
    expect(await movementCount()).toBe(moved + 2);
  });

  it("a note is optional: none is null, and blank is none", async () => {
    const { storeroomId, reason, lines } = SPOILED();
    const id = randomUUIDv7();
    expect((await waste(id, { storeroomId, reason, lines })).statusCode).toBe(
      200,
    );
    const blank = randomUUIDv7();
    expect((await waste(blank, { ...SPOILED(), note: "  " })).statusCode).toBe(
      200,
    );
    const notes = await db
      .select({ note: documents.note })
      .from(documents)
      .where(sql`${documents.id} in (${id}, ${blank})`);
    expect(notes).toEqual([{ note: null }, { note: null }]);
  });

  it("every role records waste: a counter user too", async () => {
    expect((await waste(randomUUIDv7(), SPOILED(), counter)).statusCode).toBe(
      200,
    );
  });

  it("refuses each line that can't be taken out, on its field, and posts nothing", async () => {
    const line = (more: object) => ({
      productId: tomate.id,
      quantity: "1",
      unit: "kg",
      ...more,
    });
    const refusedWith = async (
      lines: object[],
      status: number,
      body: object,
    ) => {
      const id = randomUUIDv7();
      await expectRefused(
        await waste(id, { ...SPOILED(), lines }),
        status,
        body,
      );
      expect(
        await db.select().from(documents).where(eq(documents.id, id)),
      ).toEqual([]);
    };
    const moved = await movementCount();
    await refusedWith([line({}), line({ unit: "caja" })], 400, {
      error: "invalid_input",
      fields: { "lines.1.unit": "unknown_unit" },
    });
    await refusedWith([line({ quantity: "0.0001" })], 400, {
      error: "invalid_input",
      fields: { "lines.0.quantity": "not_whole_base_units" },
    });
    await refusedWith([line({ productId: MISSING })], 400, {
      error: "invalid_input",
      fields: { "lines.0.productId": "not_found" },
    });
    // 11 kg, with 10 on hand: stock would go below zero (invariant 6).
    await refusedWith([line({}), line({ quantity: "11" })], 409, {
      error: "cannot_post",
      fields: { "lines.1.quantity": "below_zero" },
    });
    // The oil is in the dry store, not the cold room.
    await refusedWith([line({ productId: aceite.id, unit: "l" })], 409, {
      error: "cannot_post",
      fields: { "lines.0.quantity": "below_zero" },
    });
    expect(await movementCount()).toBe(moved);
  });

  it("refuses a storeroom that isn't ours, or isn't in use", async () => {
    await expectRefused(
      await waste(randomUUIDv7(), { ...SPOILED(), storeroomId: MISSING }),
      400,
      { error: "invalid_input", fields: { storeroomId: "not_found" } },
    );
    await expectRefused(
      await waste(randomUUIDv7(), { ...SPOILED(), storeroomId: closed.id }),
      400,
      { error: "invalid_input", fields: { storeroomId: "invalid" } },
    );
  });

  it("refuses a reason not on the list, no lines, and fields it doesn't take", async () => {
    await expectRefused(
      await waste(randomUUIDv7(), { ...SPOILED(), reason: "stolen" }),
      400,
      { error: "invalid_input", fields: { reason: "invalid" } },
    );
    expect(
      (await waste(randomUUIDv7(), { ...SPOILED(), lines: [] })).statusCode,
    ).toBe(400);
    expect(
      (await waste(randomUUIDv7(), { ...SPOILED(), supplierId: huerto.id }))
        .statusCode,
    ).toBe(400);
  });
});

describe("PUT /api/transfers/:id", () => {
  it("moves 4 kg of tomatoes from the cold room to the dry store at the cold room's average: −4000 there, +4000 here, 10 kg in all still", async () => {
    const id = randomUUIDv7();
    const response = await transfer(id, TO_DRY_STORE());
    expect(response.statusCode, response.body).toBe(200);
    const recorded = PostedStockDocument.parse(response.json());
    expect(recorded).toMatchObject({
      type: "transfer",
      storeroom: { id: coldRoom.id, name: "Cámara" },
      toStoreroom: { id: dryStore.id, name: "Almacén" },
      reason: null,
      note: null,
      countedAt: null,
    });
    expect(recorded.lines).toMatchObject([
      {
        product: { id: tomate.id },
        quantity: "4",
        unit: "kg",
        movements: [
          {
            storeroom: { id: coldRoom.id },
            quantity: -4000,
            unitCost: "0.001800",
            value: "-7.20",
            kind: "transfer-out",
          },
          {
            storeroom: { id: dryStore.id },
            quantity: 4000,
            unitCost: "0.001800",
            value: "7.20",
            kind: "transfer-in",
          },
        ],
      },
    ]);
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row).toMatchObject({
      status: "posted",
      type: "transfer",
      storeroomId: coldRoom.id,
      toStoreroomId: dryStore.id,
      wasteReason: null,
      supplierId: null,
    });
    expect(await stockOf(tomate.id)).toEqual({
      [coldRoom.id]: 6000,
      [dryStore.id]: 4000,
    });
  });

  it("a counter user transfers too, and the same request sent twice moves the stock once", async () => {
    const id = randomUUIDv7();
    expect((await transfer(id, TO_DRY_STORE(), counter)).statusCode).toBe(200);
    expect((await transfer(id, TO_DRY_STORE(), counter)).statusCode).toBe(200);
    expect(await stockOf(tomate.id)).toEqual({
      [coldRoom.id]: 6000,
      [dryStore.id]: 4000,
    });
  });

  it("refuses a transfer to the storeroom it comes from, to one not in use, and more than is there", async () => {
    await expectRefused(
      await transfer(randomUUIDv7(), {
        ...TO_DRY_STORE(),
        toStoreroomId: coldRoom.id,
      }),
      400,
      { error: "invalid_input", fields: { toStoreroomId: "invalid" } },
    );
    await expectRefused(
      await transfer(randomUUIDv7(), {
        ...TO_DRY_STORE(),
        toStoreroomId: closed.id,
      }),
      400,
      { error: "invalid_input", fields: { toStoreroomId: "invalid" } },
    );
    await expectRefused(
      await transfer(randomUUIDv7(), {
        ...TO_DRY_STORE(),
        lines: [{ productId: tomate.id, quantity: "10.5", unit: "kg" }],
      }),
      409,
      { error: "cannot_post", fields: { "lines.0.quantity": "below_zero" } },
    );
  });
});

describe("PUT /api/counts/:id", () => {
  it("office counts 7.5 kg of tomatoes with 10 kg on hand: −2500 g at the average, €0.001800/g, posted at once, with where and when", async () => {
    const id = randomUUIDv7();
    const countedAt = await databaseNow();
    const response = await count(id, COUNTED(countedAt));
    expect(response.statusCode, response.body).toBe(200);
    const recorded = PostedStockDocument.parse(response.json());
    expect(recorded).toMatchObject({
      type: "count",
      date: today(countedAt),
      storeroom: { id: coldRoom.id },
      toStoreroom: null,
      reason: null,
      countedAt: countedAt.toISOString(),
    });
    expect(recorded.lines).toMatchObject([
      {
        product: { id: tomate.id },
        quantity: "7.5",
        unit: "kg",
        movements: [
          {
            storeroom: { id: coldRoom.id },
            quantity: -2500,
            unitCost: "0.001800",
            value: "-4.50",
            kind: "count",
          },
        ],
      },
    ]);
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row).toMatchObject({
      status: "posted",
      type: "count",
      storeroomId: coldRoom.id,
      toStoreroomId: null,
      wasteReason: null,
      note: null,
      supplierId: null,
      countedAt,
      date: today(countedAt),
      uploadedBy: officeId,
    });
    expect(await stockOf(tomate.id)).toEqual({ [coldRoom.id]: 7500 });
  });

  it("counted before a delivery that's posted since, and synced after it: the delivery isn't counted away, so stock is what was counted plus its 5 kg", async () => {
    const countedAt = await databaseNow();
    await deliver("A-2", [reviewedLine(tomate.id, "5", "kg", "2.00")]);
    const response = await count(randomUUIDv7(), COUNTED(countedAt));
    expect(response.statusCode, response.body).toBe(200);
    // Measured against the 10 kg there were, at their average then.
    expect(
      PostedStockDocument.parse(response.json()).lines[0]!.movements,
    ).toMatchObject([{ quantity: -2500, unitCost: "0.001800" }]);
    expect(await stockOf(tomate.id)).toEqual({ [coldRoom.id]: 12_500 });
  });

  it("counted 0 before waste that's posted since: still posted, as a flagged adjustment, and the stock is below zero", async () => {
    const countedAt = await databaseNow();
    expect((await waste(randomUUIDv7(), SPOILED())).statusCode).toBe(200);
    const id = randomUUIDv7();
    const response = await count(id, {
      ...COUNTED(countedAt),
      lines: [{ productId: tomate.id, quantity: "0", unit: "kg" }],
    });
    expect(response.statusCode, response.body).toBe(200);
    const moved = await db
      .select({
        quantity: movements.quantity,
        adjustment: movements.adjustment,
      })
      .from(movements)
      .where(eq(movements.kind, "count"));
    expect(moved).toEqual([{ quantity: -10_000, adjustment: true }]);
    expect(await stockOf(tomate.id)).toEqual({ [coldRoom.id]: -2000 });
  });

  it("a product left out of the count is left as it is; 0 counted of something never there posts a movement of 0", async () => {
    const response = await count(randomUUIDv7(), {
      storeroomId: dryStore.id,
      countedAt: (await databaseNow()).toISOString(),
      lines: [{ productId: tomate.id, quantity: "0", unit: "kg" }],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      PostedStockDocument.parse(response.json()).lines[0]!.movements,
    ).toMatchObject([{ storeroom: { id: dryStore.id }, quantity: 0 }]);
    expect(await stockOf(tomate.id)).toEqual({
      [coldRoom.id]: 10_000,
      [dryStore.id]: 0,
    });
    expect(await stockOf(aceite.id)).toEqual({ [dryStore.id]: 10_000 });
  });

  it("is dated the day it was counted, in Madrid: 23:30 UTC on 29 March 2025 is the 30th there; counted that long ago, it's measured against nothing posted since", async () => {
    const id = randomUUIDv7();
    const response = await count(id, {
      ...COUNTED(new Date("2025-03-29T23:30:00Z")),
      lines: [{ productId: tomate.id, quantity: "0", unit: "kg" }],
    });
    expect(response.statusCode, response.body).toBe(200);
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    expect(row!.date).toBe("2025-03-30");
    expect(
      PostedStockDocument.parse(response.json()).lines[0]!.movements,
    ).toMatchObject([{ quantity: 0 }]);
    expect(await stockOf(tomate.id)).toEqual({ [coldRoom.id]: 10_000 });
  });

  it("refuses a product counted twice, a time more than 5 minutes ahead, a negative quantity, and a unit the product doesn't have, on their fields, and posts nothing", async () => {
    const now = await databaseNow();
    const line = (more: object = {}) => ({
      productId: tomate.id,
      quantity: "1",
      unit: "kg",
      ...more,
    });
    const moved = await movementCount();
    await expectRefused(
      await count(randomUUIDv7(), {
        ...COUNTED(now),
        lines: [line(), line({ quantity: "500", unit: "g" })],
      }),
      400,
      { error: "invalid_input", fields: { "lines.1.productId": "taken" } },
    );
    await expectRefused(
      await count(
        randomUUIDv7(),
        COUNTED(new Date(now.getTime() + 10 * 60_000)),
      ),
      400,
      { error: "invalid_input", fields: { countedAt: "invalid" } },
    );
    await expectRefused(
      await count(randomUUIDv7(), {
        ...COUNTED(now),
        lines: [line({ quantity: "-1" })],
      }),
      400,
      { error: "invalid_input", fields: { "lines.0.quantity": "invalid" } },
    );
    await expectRefused(
      await count(randomUUIDv7(), {
        ...COUNTED(now),
        lines: [line({ unit: "caja" })],
      }),
      400,
      { error: "invalid_input", fields: { "lines.0.unit": "unknown_unit" } },
    );
    await expectRefused(
      await count(randomUUIDv7(), { ...COUNTED(now), storeroomId: closed.id }),
      400,
      { error: "invalid_input", fields: { storeroomId: "invalid" } },
    );
    expect(await movementCount()).toBe(moved);
  });

  it("takes a phone's clock a minute ahead", async () => {
    const ahead = new Date((await databaseNow()).getTime() + 60_000);
    expect((await count(randomUUIDv7(), COUNTED(ahead))).statusCode).toBe(200);
  });

  it("the same count sent again, its time written in Madrid's offset, answers what was posted and posts nothing more; another time under the same ID is refused", async () => {
    const id = randomUUIDv7();
    const countedAt = new Date("2026-10-21T08:00:00Z");
    const first = await count(id, COUNTED(countedAt));
    expect(first.statusCode, first.body).toBe(200);
    const moved = await movementCount();
    const again = await count(id, {
      ...COUNTED(countedAt),
      countedAt: "2026-10-21T10:00:00+02:00",
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json()).toEqual(first.json());
    await expectRefused(
      await count(id, COUNTED(new Date("2026-10-21T08:01:00Z"))),
      409,
      { error: "conflict" },
    );
    expect(await movementCount()).toBe(moved);
  });

  it("a counter user counts; the owner reverses the count, and the stock is back, the reversal counted when the count was", async () => {
    const id = randomUUIDv7();
    const countedAt = await databaseNow();
    expect((await count(id, COUNTED(countedAt), counter)).statusCode).toBe(200);
    expect(await stockOf(tomate.id)).toEqual({ [coldRoom.id]: 7500 });
    const undone = await owner.send("POST", `/api/documents/${id}/reverse`);
    expect(undone.statusCode, undone.body).toBe(200);
    expect(await stockOf(tomate.id)).toEqual({ [coldRoom.id]: 10_000 });
    const [reversal] = await db
      .select()
      .from(documents)
      .where(eq(documents.reverses, id));
    expect(reversal).toMatchObject({ type: "count", countedAt });
  });
});

describe("stock documents among the rest", () => {
  it("stay out of Documentos, the list of supplier documents, and have no document page there; their posting is read on their own page, with euros by role (#151)", async () => {
    const id = randomUUIDv7();
    await waste(id, SPOILED());
    const list = await office.read("/api/documents", DocumentPage);
    expect(list.items.map((d) => d.id)).toEqual([delivery]);
    expect(list.total).toBe(1);
    expect((await office.send("GET", `/api/documents/${id}`)).statusCode).toBe(
      404,
    );
    for (const api of [counter, office]) {
      expect(
        (await api.send("GET", `/api/documents/${id}/posting`)).statusCode,
      ).toBe(404);
    }
  });

  it("the owner reverses waste, and the tomatoes are back; a transfer, and they're back where they were", async () => {
    const wasted = randomUUIDv7();
    await waste(wasted, SPOILED());
    const moved = randomUUIDv7();
    await transfer(moved, TO_DRY_STORE());
    expect(
      (await office.send("POST", `/api/documents/${wasted}/reverse`))
        .statusCode,
    ).toBe(403);

    const undone = await owner.send("POST", `/api/documents/${moved}/reverse`);
    expect(undone.statusCode, undone.body).toBe(200);
    expect(DocumentPosting.parse(undone.json()).reversal).toMatchObject({
      date: today(new Date()),
      lines: [
        {
          unitPrice: null,
          movements: [
            { storeroom: { id: dryStore.id }, quantity: -4000 },
            { storeroom: { id: coldRoom.id }, quantity: 4000 },
          ],
        },
      ],
    });
    expect(await stockOf(tomate.id)).toEqual({
      [coldRoom.id]: 8000,
      [dryStore.id]: 0,
    });

    expect(
      (await owner.send("POST", `/api/documents/${wasted}/reverse`)).statusCode,
    ).toBe(200);
    expect(await stockOf(tomate.id)).toEqual({
      [coldRoom.id]: 10_000,
      [dryStore.id]: 0,
    });
  });

  it("a reversed stock document has no corrected copy: it has no files to review again", async () => {
    const id = randomUUIDv7();
    await waste(id, SPOILED());
    await owner.send("POST", `/api/documents/${id}/reverse`);
    expect(
      (await owner.send("POST", `/api/documents/${id}/copy`)).statusCode,
    ).toBe(404);
  });
});

describe("GET /api/stock-documents/:id (#151)", () => {
  const read = (id: string, api = office) =>
    api.read(`/api/stock-documents/${id}`, PostedStockDocument);
  /** Every key in an answer, nested ones included: what a role is sent, whatever the schema. */
  const keysOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keysOf)
      : value !== null && typeof value === "object"
        ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)])
        : [];

  it("office reads waste as it was recorded: what, where, why, who, when, and each movement at its cost", async () => {
    const id = randomUUIDv7();
    await waste(id, SPOILED());
    expect(await read(id)).toEqual({
      id,
      type: "waste",
      date: today(new Date()),
      storeroom: { id: coldRoom.id, name: "Cámara" },
      toStoreroom: null,
      reason: "spoiled",
      note: "Se rompió la cámara el fin de semana",
      countedAt: null,
      recordedBy: { id: officeId, name: "Test office" },
      lines: [
        {
          position: 1,
          product: { id: tomate.id, name: "Tomate pera", baseUnit: "g" },
          quantity: "2",
          unit: "kg",
          movements: [
            {
              id: expect.any(String),
              storeroom: { id: coldRoom.id, name: "Cámara" },
              quantity: -2000,
              unitCost: "0.001800",
              value: "-3.60",
              kind: "waste",
            },
          ],
        },
      ],
      reversal: null,
    });
  });

  it("a transfer names both storerooms; a count, when it was counted", async () => {
    const moved = randomUUIDv7();
    await transfer(moved, TO_DRY_STORE(), counter);
    expect(await read(moved)).toMatchObject({
      type: "transfer",
      storeroom: { id: coldRoom.id, name: "Cámara" },
      toStoreroom: { id: dryStore.id, name: "Almacén" },
      recordedBy: { name: "Test counter" },
      lines: [
        {
          movements: [
            { storeroom: { id: coldRoom.id }, kind: "transfer-out" },
            { storeroom: { id: dryStore.id }, kind: "transfer-in" },
          ],
        },
      ],
    });
    const counted = randomUUIDv7();
    const countedAt = await databaseNow();
    await count(counted, COUNTED(countedAt));
    expect(await read(counted)).toMatchObject({
      type: "count",
      countedAt: countedAt.toISOString(),
      toStoreroom: null,
    });
  });

  it("a reversed waste shows its reversal: when, by whom, and the movements that undid it", async () => {
    const id = randomUUIDv7();
    await waste(id, SPOILED());
    const ownerId = (await owner.read("/api/me", MeResponse)).id;
    await owner.send("POST", `/api/documents/${id}/reverse`);
    expect((await read(id)).reversal).toEqual({
      id: expect.any(String),
      date: today(new Date()),
      reversedBy: { id: ownerId, name: "Test owner" },
      lines: [
        expect.objectContaining({
          position: 1,
          quantity: "2",
          unit: "kg",
          movements: [
            expect.objectContaining({
              storeroom: { id: coldRoom.id, name: "Cámara" },
              quantity: 2000,
              unitCost: "0.001800",
              value: "3.60",
            }),
          ],
        }),
      ],
    });
  });

  it("a counter user reads it without a euro: no unit cost or value on any movement, its reversal's included", async () => {
    const id = randomUUIDv7();
    await waste(id, SPOILED());
    await owner.send("POST", `/api/documents/${id}/reverse`);
    const response = await counter.send("GET", `/api/stock-documents/${id}`);
    expect(response.statusCode, response.body).toBe(200);
    const body: unknown = response.json();
    expect(keysOf(body)).not.toContain("unitCost");
    expect(keysOf(body)).not.toContain("value");
    const answer = PostedStockDocument.parse(body);
    expect(answer.lines[0]!.movements).toEqual([
      expect.objectContaining({ quantity: -2000, kind: "waste" }),
    ]);
    expect(answer.reversal!.lines[0]!.movements).toEqual([
      expect.objectContaining({ quantity: 2000 }),
    ]);
  });

  it("recording answers what reading does, by role: euros for office, none for a counter user, sent again or not", async () => {
    for (const api of [office, counter]) {
      const id = randomUUIDv7();
      const recorded = await waste(id, SPOILED(), api);
      const again = await waste(id, SPOILED(), api);
      const moved = randomUUIDv7();
      const transferred = await transfer(moved, TO_DRY_STORE(), api);
      const counted = randomUUIDv7();
      const counting = await count(counted, COUNTED(await databaseNow()), api);
      for (const [response, docId] of [
        [recorded, id],
        [again, id],
        [transferred, moved],
        [counting, counted],
      ] as const) {
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json()).toEqual(
          (await api.send("GET", `/api/stock-documents/${docId}`)).json(),
        );
        expect(keysOf(response.json()).includes("unitCost")).toBe(
          api === office,
        );
        expect(keysOf(response.json()).includes("value")).toBe(api === office);
      }
    }
  });

  it("a movement's value (#152) is its quantity at its cost, rounded once to cents, half away from zero: 3 g out at €0.001667/g is -€0.01", async () => {
    const sal = await office.created(
      "/api/products",
      { name: "Sal en escamas", baseUnit: "g", category: "dry_goods" },
      Product,
    );
    await deliver("A-2", [reviewedLine(sal.id, "1000", "g", "0.001667")]);
    const id = randomUUIDv7();
    await waste(id, {
      storeroomId: coldRoom.id,
      reason: "broken",
      lines: [
        { productId: sal.id, quantity: "3", unit: "g" },
        { productId: sal.id, quantity: "2", unit: "g" },
      ],
    });
    const { lines } = await read(id);
    // -0.005001 € is past half a cent; -0.003334 € isn't, and is no euros at all, unsigned.
    expect(lines.map((l) => l.movements[0]!.value)).toEqual(["-0.01", "0.00"]);
  });

  it("is a stock document's only: 404 for a supplier document, a reversal, and an ID that's no document; 401 signed out", async () => {
    const id = randomUUIDv7();
    await waste(id, SPOILED());
    await owner.send("POST", `/api/documents/${id}/reverse`);
    const [reversal] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.reverses, id));
    for (const missing of [delivery, reversal!.id, MISSING]) {
      expect(
        (await office.send("GET", `/api/stock-documents/${missing}`))
          .statusCode,
      ).toBe(404);
    }
    expect(
      (await app.inject({ method: "GET", url: `/api/stock-documents/${id}` }))
        .statusCode,
    ).toBe(401);
  });
});

describe("movements' times", () => {
  it("follow the order they're posted in, even for a request whose transaction began before another that posted ahead of it", async () => {
    const wasteOf = (kg: string) =>
      ({
        type: "waste",
        storeroomId: coldRoom.id,
        reason: "spoiled",
        note: null,
        lines: [{ productId: tomate.id, quantity: kg, unit: "kg" }],
      }) as const;
    const context = { userId: officeId, requestId: "times" };
    await db.transaction(async (begunFirst) => {
      // While this transaction is open, another request records waste and commits.
      const ahead = await recordStockDocument(
        db,
        context,
        randomUUIDv7(),
        wasteOf("1"),
        { date: today(new Date()) },
      );
      expect(ahead.ok).toBe(true);
      // Then this one posts: `audited` runs it in a savepoint of the transaction begun first,
      // so the transaction stands in for the database here.
      const behind = await recordStockDocument(
        begunFirst as unknown as Db,
        context,
        randomUUIDv7(),
        wasteOf("2"),
        { date: today(new Date()) },
      );
      expect(behind.ok).toBe(true);
    });
    const stamped = await db
      .select({ createdAt: movements.createdAt })
      .from(movements)
      .orderBy(asc(movements.sequence));
    expect(stamped).toHaveLength(4);
    for (let i = 1; i < stamped.length; i++) {
      expect(stamped[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        stamped[i - 1]!.createdAt.getTime(),
      );
    }
  });
});
