import { randomUUIDv7 } from "node:crypto";
import {
  Document,
  endpoints,
  MeResponse,
  Product,
  Storeroom,
  Supplier,
  SupplierProduct,
} from "@kitchen-ops/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import {
  auditLog,
  documentFiles,
  documentLines,
  documents,
  products,
  storerooms,
  suppliers,
  users,
} from "../db/schema";
import { fakeDocument, fakeMisread } from "../extraction/fake";
import { signedInAs, signedInAsOwner } from "../test/auth";
import { createMemoryStorage } from "../storage/memory";
import { syntheticCif } from "../test/catalogue";
import { multipart, sample } from "../test/documents";
import { testConfig } from "../test/helpers";
import { documentRead, draftWith, postedFrom } from "../test/matching";

// Every write endpoint records its changes in the audit log (#87). A new write endpoint fails
// the first test until it has a case here: the audit log can't be forgotten.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config, { storage: createMemoryStorage() });
afterAll(async () => {
  await app.close();
  await close();
});

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${documents}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
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
    send: (method: "POST" | "PATCH" | "PUT", url: string, payload: object) =>
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

  async createProduct() {
    const office = await officeUser();
    const create = (body: object) => office.send("POST", "/api/products", body);

    const response = await create(TOMATE);
    expect(response.statusCode).toBe(201);
    const tomate = Product.parse(response.json());
    expect(await entriesFor("product", tomate.id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        changes: {
          id: { before: null, after: tomate.id },
          name: { before: null, after: "Tomate pera" },
          baseUnit: { before: null, after: "g" },
          category: { before: null, after: "produce" },
          active: { before: null, after: true },
          conversions: {
            before: null,
            after: [
              { unit: "kg", factor: 1000 },
              { unit: "caja", factor: 6000 },
            ],
          },
        },
      }),
    ]);

    expect(
      (
        await create({
          ...TOMATE,
          name: "Otro",
          conversions: [{ unit: "g", factor: 1 }],
        })
      ).statusCode,
    ).toBe(400);
    expect((await create({ ...TOMATE, name: "tomate pera" })).statusCode).toBe(
      409,
    );
    expect(await allEntries("product")).toHaveLength(1);
  },

  async updateProduct() {
    const office = await officeUser();
    const tomate = Product.parse(
      (await office.send("POST", "/api/products", TOMATE)).json(),
    );
    const update = (body: object) =>
      office.send("PATCH", `/api/products/${tomate.id}`, body);

    const response = await update({
      category: "produce",
      conversions: [
        { unit: "caja", factor: 5000 },
        { unit: "kg", factor: 1000 },
      ],
    });
    expect(response.statusCode).toBe(200);
    expect(await updatesOf("product", tomate.id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        requestId: response.headers["x-request-id"],
        // The conversions as a whole, before and after; the category didn't change.
        changes: {
          conversions: {
            before: [
              { unit: "kg", factor: 1000 },
              { unit: "caja", factor: 6000 },
            ],
            after: [
              { unit: "kg", factor: 1000 },
              { unit: "caja", factor: 5000 },
            ],
          },
        },
      }),
    ]);

    // The same list in another order changes nothing; refused changes record nothing.
    expect(
      (
        await update({
          conversions: [
            { unit: "kg", factor: 1000 },
            { unit: "caja", factor: 5000 },
          ],
        })
      ).statusCode,
    ).toBe(200);
    expect((await update({ baseUnit: "ml" })).statusCode).toBe(400);
    expect(
      (await update({ conversions: [{ unit: "G", factor: 1 }] })).statusCode,
    ).toBe(400);
    expect(await updatesOf("product", tomate.id)).toHaveLength(1);
  },

  async createSupplierProduct() {
    const office = await officeUser();
    const { supplier, product } = await supplierAndProduct(office);
    const create = (body: object) =>
      office.send("POST", "/api/supplier-products", {
        supplierId: supplier.id,
        code: "TOM-6",
        description: "Tomate pera, caja de 6 kg",
        productId: product.id,
        pack: { quantity: "6", unit: "kg" },
        ...body,
      });

    const response = await create({});
    expect(response.statusCode).toBe(201);
    const offer = SupplierProduct.parse(response.json());
    expect(await entriesFor("supplier_product", offer.id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        changes: {
          id: { before: null, after: offer.id },
          supplierId: { before: null, after: supplier.id },
          code: { before: null, after: "TOM-6" },
          description: { before: null, after: "Tomate pera, caja de 6 kg" },
          productId: { before: null, after: product.id },
          pack: { before: null, after: { quantity: "6", unit: "kg" } },
          active: { before: null, after: true },
        },
      }),
    ]);

    expect(
      (await create({ code: "X", pack: { quantity: "6", unit: "lata" } }))
        .statusCode,
    ).toBe(400);
    expect((await create({})).statusCode).toBe(409);
    expect(await allEntries("supplier_product")).toHaveLength(1);
  },

  async updateSupplierProduct() {
    const office = await officeUser();
    const { supplier, product } = await supplierAndProduct(office);
    const offer = SupplierProduct.parse(
      (
        await office.send("POST", "/api/supplier-products", {
          supplierId: supplier.id,
          code: "TOM-6",
          description: "Tomate pera, caja de 6 kg",
          productId: product.id,
          pack: { quantity: "6", unit: "kg" },
        })
      ).json(),
    );
    const update = (body: object) =>
      office.send("PATCH", `/api/supplier-products/${offer.id}`, body);

    const response = await update({ pack: { quantity: "1", unit: "caja" } });
    expect(response.statusCode).toBe(200);
    expect(await updatesOf("supplier_product", offer.id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        requestId: response.headers["x-request-id"],
        changes: {
          pack: {
            before: { quantity: "6", unit: "kg" },
            after: { quantity: "1", unit: "caja" },
          },
        },
      }),
    ]);

    expect(
      (await update({ pack: { quantity: "1.000", unit: "caja" } })).statusCode,
    ).toBe(200);
    expect(
      (await update({ pack: { quantity: "0.0001", unit: "kg" } })).statusCode,
    ).toBe(400);
    expect(await updatesOf("supplier_product", offer.id)).toHaveLength(1);
  },

  async uploadDocument() {
    const cookie = await signedInAs(app, auth, "counter");
    const me = MeResponse.parse(
      (
        await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })
      ).json(),
    );
    const upload = (bytes: Uint8Array[]) => {
      const body = multipart(
        bytes.map((b, i) => ({ name: `${i}.jpg`, bytes: b })),
      );
      return app.inject({
        method: "POST",
        url: "/api/documents",
        headers: { ...body.headers, cookie },
        payload: body.payload,
      });
    };

    const response = await upload([sample.jpeg(1), sample.jpeg(2)]);
    expect(response.statusCode).toBe(201);
    const document = Document.parse(response.json());
    expect(await entriesFor("document", document.id)).toEqual([
      expect.objectContaining({
        userId: me.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        // The document behind the change is this one.
        documentId: document.id,
        changes: {
          id: { before: null, after: document.id },
          status: { before: null, after: "queued" },
          files: {
            before: null,
            after: [
              expect.objectContaining({ position: 1, kind: "image" }),
              expect.objectContaining({ position: 2, kind: "image" }),
            ],
          },
        },
      }),
    ]);

    // Refused, or a duplicate: nothing recorded.
    expect((await upload([])).statusCode).toBe(400);
    expect((await upload([sample.jpeg(1)])).statusCode).toBe(409);
    expect(await allEntries("document")).toHaveLength(1);
  },

  async retryDocument() {
    const cookie = await signedInAs(app, auth, "counter");
    const body = multipart([{ name: "a.pdf", bytes: sample.pdf(1) }]);
    const document = Document.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/documents",
          headers: { ...body.headers, cookie },
          payload: body.payload,
        })
      ).json(),
    );
    // As the job leaves it after its last try (src/extraction/read.ts).
    await db
      .update(documents)
      .set({ status: "failed", failureReason: "model_unreachable" })
      .where(eq(documents.id, document.id));
    const retry = () =>
      app.inject({
        method: "POST",
        url: `/api/documents/${document.id}/retry`,
        headers: { cookie },
      });

    const response = await retry();
    expect(response.statusCode).toBe(200);
    expect(await updatesOf("document", document.id)).toEqual([
      expect.objectContaining({
        action: "update",
        requestId: response.headers["x-request-id"],
        documentId: document.id,
        changes: {
          status: { before: "failed", after: "queued" },
          failureReason: { before: "model_unreachable", after: null },
        },
      }),
    ]);

    // Not failed any more: 409, and nothing recorded.
    expect((await retry()).statusCode).toBe(409);
    expect(await updatesOf("document", document.id)).toHaveLength(1);
  },

  async setDocumentSupplier() {
    const office = await officeUser();
    const { supplier } = await supplierAndProduct(office);
    const id = await documentRead(db, { uploadedBy: office.id });
    const choose = (supplierId: string) =>
      office.send("PUT", `/api/documents/${id}/supplier`, { supplierId });

    const response = await choose(supplier.id);
    expect(response.statusCode).toBe(200);
    expect(await updatesOf("document", id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "update",
        requestId: response.headers["x-request-id"],
        documentId: id,
        changes: { supplierId: { before: null, after: supplier.id } },
      }),
    ]);

    // The same supplier again changes nothing; one that doesn't exist is refused.
    expect((await choose(supplier.id)).statusCode).toBe(200);
    expect(
      (await choose("0199a000-0000-7000-8000-000000000000")).statusCode,
    ).toBe(400);
    expect(await updatesOf("document", id)).toHaveLength(1);
  },

  async createLineMapping() {
    const office = await officeUser();
    const { supplier, product } = await supplierAndProduct(office);
    const id = await documentRead(db, {
      uploadedBy: office.id,
      supplierId: supplier.id,
      draft: draftWith([{ supplierCode: "T-01", description: "Tomate pera" }]),
    });
    const remember = () =>
      office.send("POST", `/api/documents/${id}/lines/1/mapping`, {
        productId: product.id,
        pack: { quantity: "6", unit: "kg" },
      });

    const response = await remember();
    expect(response.statusCode).toBe(201);
    const created = await allEntries("supplier_product");
    expect(created).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        documentId: id,
        changes: expect.objectContaining({
          code: { before: null, after: "T-01" },
          description: { before: null, after: "Tomate pera" },
          productId: { before: null, after: product.id },
          pack: { before: null, after: { quantity: "6", unit: "kg" } },
        }),
      }),
    ]);

    // The line is remembered now: a second time is refused, and records nothing.
    expect((await remember()).statusCode).toBe(409);
    expect(await allEntries("supplier_product")).toHaveLength(1);
  },

  async setDocumentBilling() {
    const office = await officeUser();
    const { supplier } = await supplierAndProduct(office);
    const id = await documentRead(db, {
      uploadedBy: office.id,
      supplierId: supplier.id,
      draft: {
        ...draftWith([{ supplierCode: "T-01", description: "Tomate pera" }]),
        documentType: "invoice",
      },
    });
    const bill = (lines: object[]) =>
      office.send("PUT", `/api/documents/${id}/billing`, { lines });

    const response = await bill([{ received: true }]);
    expect(response.statusCode).toBe(200);
    expect(await allEntries("invoice_line_bill")).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        documentId: id,
        // No delivery-note line: null before and after, so not a change.
        changes: {
          position: { before: null, after: 1 },
          received: { before: null, after: true },
        },
      }),
    ]);

    // The same choice again changes nothing; the wrong number of lines is refused.
    expect((await bill([{ received: true }])).statusCode).toBe(200);
    expect((await bill([])).statusCode).toBe(400);
    expect(await allEntries("invoice_line_bill")).toHaveLength(1);
  },

  async saveDocumentDraft() {
    const office = await officeUser();
    const id = await documentRead(db, {
      uploadedBy: office.id,
      draft: fakeMisread("2026-10-20"),
    });
    const save = (draft: object) =>
      office.send("PUT", `/api/documents/${id}/draft`, draft);
    const corrected = fakeDocument("2026-10-20");

    const response = await save(corrected);
    expect(response.statusCode).toBe(200);
    // The correction, and the header it gives the document. Not the checks: they follow from it.
    expect(await updatesOf("document", id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "update",
        requestId: response.headers["x-request-id"],
        documentId: id,
        changes: {
          corrected: { before: null, after: corrected },
          type: { before: null, after: "delivery-note" },
          number: { before: null, after: "ALB-0001" },
          date: { before: null, after: "2026-10-20" },
        },
      }),
    ]);

    // The same correction again changes nothing; one the schema doesn't take is refused.
    expect((await save(corrected)).statusCode).toBe(200);
    expect((await save({ ...corrected, lines: [] })).statusCode).toBe(400);
    expect(await updatesOf("document", id)).toHaveLength(1);
  },

  async checkDocumentDraft() {
    const office = await officeUser();
    const id = await documentRead(db, {
      uploadedBy: office.id,
      draft: fakeMisread("2026-10-20"),
    });
    const response = await office.send(
      "POST",
      `/api/documents/${id}/draft/checks`,
      fakeDocument("2026-10-20"),
    );
    // Checking writes nothing, so it records nothing.
    expect(response.statusCode).toBe(200);
    expect(await allEntries("document")).toEqual([]);
  },

  async postDocument() {
    const office = await officeUser();
    const id = await postable(office);
    const postIt = () =>
      office.send("POST", `/api/documents/${id}/post`, { storerooms: [null] });

    const response = await postIt();
    expect(response.statusCode).toBe(200);
    // The document posted with its header; its lines and movements are records of their own.
    expect(await updatesOf("document", id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "update",
        requestId: response.headers["x-request-id"],
        documentId: id,
        changes: {
          status: { before: "ready_for_review", after: "posted" },
          type: { before: null, after: "delivery-note" },
          number: { before: null, after: "ALB-0001" },
          date: { before: null, after: "2026-10-20" },
        },
      }),
    ]);

    // Posted already: refused, and nothing recorded.
    expect((await postIt()).statusCode).toBe(409);
    expect(await updatesOf("document", id)).toHaveLength(1);
  },

  async reverseDocument() {
    const office = await officeUser();
    const id = await postable(office);
    expect(
      (
        await office.send("POST", `/api/documents/${id}/post`, {
          storerooms: [null],
        })
      ).statusCode,
    ).toBe(200);
    const owner = await ownerUser();
    const reverseIt = () => owner.send("POST", `/api/documents/${id}/reverse`);

    const response = await reverseIt();
    expect(response.statusCode).toBe(200);
    // A reversal is a document of its own (decision 0034): its creation is the entry.
    const created = (await allEntries("document")).filter(
      (e) => e.action === "create",
    );
    expect(created).toEqual([
      expect.objectContaining({
        userId: owner.id,
        requestId: response.headers["x-request-id"],
        changes: expect.objectContaining({
          reverses: { before: null, after: id },
          status: { before: null, after: "posted" },
        }),
      }),
    ]);

    // Reversed already: refused, and nothing recorded.
    expect((await reverseIt()).statusCode).toBe(409);
    expect(await allEntries("document")).toHaveLength(2);
  },

  async recordWaste() {
    const office = await officeUser();
    const { productId, storeroomId } = await somethingInStock(office);
    const id = randomUUIDv7();
    const body = {
      storeroomId,
      reason: "expired",
      lines: [{ productId, quantity: "1", unit: "kg" }],
    };
    const record = (sent: object) =>
      office.send("PUT", `/api/waste/${id}`, sent);

    const response = await record(body);
    expect(response.statusCode).toBe(200);
    // A stock document is created posted (#149): its creation is the entry.
    expect(await entriesFor("document", id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        documentId: id,
        changes: expect.objectContaining({
          type: { before: null, after: "waste" },
          status: { before: null, after: "posted" },
          storeroomId: { before: null, after: storeroomId },
          wasteReason: { before: null, after: "expired" },
        }),
      }),
    ]);

    // Sent again, it answers what was posted, and records nothing; another body is refused.
    expect((await record(body)).statusCode).toBe(200);
    expect((await record({ ...body, reason: "other" })).statusCode).toBe(409);
    expect(await entriesFor("document", id)).toHaveLength(1);
  },

  async recordTransfer() {
    const office = await officeUser();
    const { productId, storeroomId } = await somethingInStock(office);
    const bar = Storeroom.parse(
      (
        await office.send("POST", "/api/storerooms", {
          name: "Barra",
          type: "bar",
        })
      ).json(),
    );
    const id = randomUUIDv7();
    const body = {
      storeroomId,
      toStoreroomId: bar.id,
      lines: [{ productId, quantity: "1", unit: "kg" }],
    };
    const record = (sent: object) =>
      office.send("PUT", `/api/transfers/${id}`, sent);

    const response = await record(body);
    expect(response.statusCode).toBe(200);
    expect(await entriesFor("document", id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        documentId: id,
        changes: expect.objectContaining({
          type: { before: null, after: "transfer" },
          storeroomId: { before: null, after: storeroomId },
          toStoreroomId: { before: null, after: bar.id },
        }),
      }),
    ]);

    expect((await record(body)).statusCode).toBe(200);
    // Another body under the same ID is refused (409), and records nothing.
    expect(
      (await record({ ...body, toStoreroomId: storeroomId })).statusCode,
    ).toBe(409);
    expect(await entriesFor("document", id)).toHaveLength(1);
  },

  async recordCount() {
    const office = await officeUser();
    const { productId, storeroomId } = await somethingInStock(office);
    const id = randomUUIDv7();
    const countedAt = new Date(Date.now() - 60_000).toISOString();
    const body = {
      storeroomId,
      countedAt,
      lines: [{ productId, quantity: "0.5", unit: "kg" }],
    };
    const record = (sent: object) =>
      office.send("PUT", `/api/counts/${id}`, sent);

    const response = await record(body);
    expect(response.statusCode).toBe(200);
    expect(await entriesFor("document", id)).toEqual([
      expect.objectContaining({
        userId: office.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        documentId: id,
        changes: expect.objectContaining({
          type: { before: null, after: "count" },
          status: { before: null, after: "posted" },
          storeroomId: { before: null, after: storeroomId },
          countedAt: { before: null, after: countedAt },
        }),
      }),
    ]);

    expect((await record(body)).statusCode).toBe(200);
    // Another body under the same ID is refused (409), and records nothing.
    expect(
      (
        await record({
          ...body,
          lines: [{ productId, quantity: "0.4", unit: "kg" }],
        })
      ).statusCode,
    ).toBe(409);
    expect(await entriesFor("document", id)).toHaveLength(1);
  },

  async createDocumentCopy() {
    const office = await officeUser();
    const supplier = Supplier.parse(
      (
        await office.send("POST", "/api/suppliers", {
          name: "Huerto",
          taxId: syntheticCif(1),
        })
      ).json(),
    );
    const id = await postedFrom(db, office.id, supplier.id, {
      reversed: true,
    });
    // Its photo, which the copy is shown with.
    await db.insert(documentFiles).values({
      documentId: id,
      position: 1,
      kind: "image",
      contentType: "image/jpeg",
      sizeBytes: 1,
      sha256: id,
      storageKey: `documents/${id}/1.jpg`,
    });
    const owner = await ownerUser();
    const copyIt = () => owner.send("POST", `/api/documents/${id}/copy`);

    const response = await copyIt();
    expect(response.statusCode).toBe(201);
    const copied = Document.parse(response.json());
    expect(await entriesFor("document", copied.id)).toEqual([
      expect.objectContaining({
        userId: owner.id,
        action: "create",
        requestId: response.headers["x-request-id"],
        documentId: copied.id,
        changes: expect.objectContaining({
          copyOf: { before: null, after: id },
          status: { before: null, after: "ready_for_review" },
          supplierId: { before: null, after: supplier.id },
        }),
      }),
    ]);

    // Copied already: refused, and nothing recorded.
    expect((await copyIt()).statusCode).toBe(409);
    expect(await allEntries("document")).toHaveLength(1);
  },
};

/** A signed-in owner: its ID, and a way to call the API as it. */
async function ownerUser() {
  const cookie = await signedInAsOwner(app, auth);
  const me = MeResponse.parse(
    (
      await app.inject({ method: "GET", url: "/api/me", headers: { cookie } })
    ).json(),
  );
  return {
    id: me.id,
    send: (method: "POST", url: string) =>
      app.inject({ method, url, headers: { cookie } }),
  };
}

/**
 * A delivery note ready to post: one line of tomatoes, T-01, a supplier product of its
 * supplier, kept in a storeroom of its own. Its file is there, as an upload leaves it.
 */
/** A delivery note posted, and the product it brought, where it went: 5 kg of tomatoes. */
async function somethingInStock(
  office: Awaited<ReturnType<typeof officeUser>>,
) {
  const id = await postable(office);
  const posted = await office.send("POST", `/api/documents/${id}/post`, {
    storerooms: [null],
  });
  expect(posted.statusCode).toBe(200);
  const [line] = await db
    .select({
      productId: documentLines.productId,
      storeroomId: documentLines.storeroomId,
    })
    .from(documentLines)
    .where(eq(documentLines.documentId, id));
  return { productId: line!.productId, storeroomId: line!.storeroomId! };
}

async function postable(office: Awaited<ReturnType<typeof officeUser>>) {
  const { supplier, product } = await supplierAndProduct(office);
  const storeroom = Storeroom.parse(
    (
      await office.send("POST", "/api/storerooms", {
        name: "Cámara",
        type: "cold_room",
      })
    ).json(),
  );
  await office.send("PATCH", `/api/products/${product.id}`, {
    defaultStoreroomId: storeroom.id,
  });
  await office.send("POST", "/api/supplier-products", {
    supplierId: supplier.id,
    code: "T-01",
    description: "Tomate pera",
    productId: product.id,
    pack: { quantity: "1", unit: "kg" },
  });
  const id = await documentRead(db, {
    uploadedBy: office.id,
    supplierId: supplier.id,
    draft: draftWith([{ supplierCode: "T-01", description: "Tomate pera" }]),
  });
  await db.insert(documentFiles).values({
    documentId: id,
    position: 1,
    kind: "image",
    contentType: "image/jpeg",
    sizeBytes: 1,
    sha256: id,
    storageKey: `documents/${id}/1.jpg`,
  });
  return id;
}

const TOMATE = {
  name: "Tomate pera",
  baseUnit: "g",
  category: "produce",
  conversions: [
    { unit: "caja", factor: 6000 },
    { unit: "kg", factor: 1000 },
  ],
};

/** A supplier and a product to make a supplier product of, created as the office user. */
async function supplierAndProduct(
  office: Awaited<ReturnType<typeof officeUser>>,
) {
  const supplier = Supplier.parse(
    (
      await office.send("POST", "/api/suppliers", {
        name: "Huerto",
        taxId: syntheticCif(1),
      })
    ).json(),
  );
  const product = Product.parse(
    (await office.send("POST", "/api/products", TOMATE)).json(),
  );
  return { supplier, product };
}

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
