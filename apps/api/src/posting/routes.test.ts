import * as ledger from "@kitchen-ops/ledger";
import {
  Document,
  DocumentPage,
  DocumentPosting,
  MeResponse,
  NEW_SUPPLIER_DOCUMENTS,
  Product,
  Storeroom,
  Supplier,
  SupplierProduct,
  type ExtractedDocument,
} from "@kitchen-ops/shared";
import { asc, eq, sql } from "drizzle-orm";
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
import { fakeDocument } from "../extraction/fake";
import { today } from "../extraction/read";
import { createMemoryStorage } from "../storage/memory";
import { signedInAs, signedInAsOwner } from "../test/auth";
import { apiAs, syntheticCif } from "../test/catalogue";
import { multipart, sample } from "../test/documents";
import { testConfig } from "../test/helpers";
import { documentRead, postedFrom } from "../test/matching";
import { postDocument, reverseDocument } from "./posting";
import { movementsOf } from "./stored";

// Posting a reviewed delivery note, reversing a posted document, and reviewing a corrected copy
// of a reversed one (#119, decision 0038), through the API. How a draft becomes the lines
// posted is in reviewed.test.ts; posting itself, in posting.test.ts and properties.test.ts.

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const app = buildApp(config, { storage: createMemoryStorage() });
afterAll(async () => {
  await app.close();
  await close();
});

const MISSING = "0199a000-0000-7000-8000-000000000000";

let officeCookie: string;
let office: ReturnType<typeof apiAs>;
let officeId: string;
let owner: ReturnType<typeof apiAs>;
let ownerId: string;
let coldRoom: Storeroom;
let dryStore: Storeroom;
let huerto: Supplier;
/** Kept in the cold room; bought by the kg (T-01). */
let tomate: Product;
/** No storeroom of its own; bought in 5 l garrafas, matched by description. */
let aceite: Product;
let tomateKilo: SupplierProduct;
let aceiteGarrafa: SupplierProduct;

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${documents}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
  );
  officeCookie = await signedInAs(app, auth, "office");
  office = apiAs(app, officeCookie);
  officeId = (await office.read("/api/me", MeResponse)).id;
  owner = apiAs(app, await signedInAsOwner(app, auth));
  ownerId = (await owner.read("/api/me", MeResponse)).id;
  coldRoom = await office.created(
    "/api/storerooms",
    { name: "Cámara", type: "cold_room" },
    Storeroom,
  );
  dryStore = await office.created(
    "/api/storerooms",
    { name: "Almacén", type: "dry_store" },
    Storeroom,
  );
  huerto = await office.created(
    "/api/suppliers",
    // Not the fake model's supplier, B00000018 (syntheticCif(1)).
    { name: "Frutas El Huerto, S.L.", taxId: syntheticCif(11) },
    Supplier,
  );
  tomate = await office.created(
    "/api/products",
    {
      name: "Tomate pera",
      baseUnit: "g",
      category: "produce",
      defaultStoreroomId: coldRoom.id,
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
  tomateKilo = await office.created(
    "/api/supplier-products",
    {
      supplierId: huerto.id,
      code: "T-01",
      description: "Tomate pera",
      productId: tomate.id,
      pack: { quantity: "1", unit: "kg" },
    },
    SupplierProduct,
  );
  aceiteGarrafa = await office.created(
    "/api/supplier-products",
    {
      supplierId: huerto.id,
      code: null,
      description: "Aceite de oliva virgen extra 5 l",
      productId: aceite.id,
      pack: { quantity: "5", unit: "l" },
    },
    SupplierProduct,
  );
});

/**
 * What the fake model reads, dated today: 5 kg of tomatoes (T-01) at €1.80, and 2 garrafas of
 * oil at €24.50, matched by description.
 */
const printed = (): ExtractedDocument => fakeDocument(today(new Date()));

/** A document in review from El Huerto, as the reading job leaves one: one photo of it. */
async function inReview(
  draft: ExtractedDocument | null = printed(),
  values: { supplierId?: string | null; failedChecks?: boolean } = {},
) {
  const id = await documentRead(db, {
    uploadedBy: officeId,
    supplierId: huerto.id,
    draft,
    ...values,
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

/** El Huerto with enough posted documents not to be new any more. */
async function established() {
  for (let i = 0; i < NEW_SUPPLIER_DOCUMENTS; i++) {
    await postedFrom(db, officeId, huerto.id, { number: `OLD-${i}` });
  }
}

/** Tomatoes into their own storeroom; the oil, which has none, into the dry store. */
const STOREROOMS = () => ({ storerooms: [null, dryStore.id] });

const post = (id: string, body: object = STOREROOMS(), api = office) =>
  api.send("POST", `/api/documents/${id}/post`, body);
const reverse = (id: string, api = owner) =>
  api.send("POST", `/api/documents/${id}/reverse`);
const copy = (id: string, api = owner) =>
  api.send("POST", `/api/documents/${id}/copy`);
const postingOf = (id: string, api = office) =>
  api.read(`/api/documents/${id}/posting`, DocumentPosting);
const getDocument = (id: string) =>
  office.read(`/api/documents/${id}`, Document);

async function posted(id: string) {
  const response = await post(id);
  expect(response.statusCode, response.body).toBe(200);
  return DocumentPosting.parse(response.json());
}

/** Stock on hand of a product, per the stored movements read back through the ledger. */
async function stock(productId: string, storeroomId: string) {
  return ledger.stockOnHand(
    await movementsOf(db, [productId]),
    productId,
    storeroomId,
  );
}

/** Everything posting can write, to check that a refusal writes nothing. */
async function snapshot() {
  const [d, l, a] = await Promise.all([
    db.select().from(documents).orderBy(asc(documents.id)),
    db.select().from(documentLines).orderBy(asc(documentLines.id)),
    db.select().from(auditLog).orderBy(asc(auditLog.id)),
  ]);
  return { d, l, m: await movementsOf(db), a };
}

async function expectRefused(
  response: Awaited<ReturnType<typeof post>>,
  status: number,
  body: object,
) {
  expect(response.statusCode, response.body).toBe(status);
  expect(response.json()).toEqual(body);
}

describe("POST /api/documents/:id/post", () => {
  it("office posts a reviewed delivery note from a new supplier: each line at its pack, into its storeroom, and the document is posted with its header", async () => {
    const id = await inReview();
    const result = await posted(id);

    expect(result.reversal).toBeNull();
    expect(result.lines).toEqual([
      {
        position: 1,
        product: { id: tomate.id, name: "Tomate pera", baseUnit: "g" },
        quantity: "5",
        unit: "kg",
        unitPrice: "1.800000",
        discountPercent: null,
        vatRate: "10.00",
        storeroom: { id: coldRoom.id, name: "Cámara" },
        movements: [
          {
            id: expect.any(String),
            storeroom: { id: coldRoom.id, name: "Cámara" },
            // 5 kg: €9.00 for 5000 g.
            quantity: 5000,
            unitCost: "0.001800",
            kind: "receipt",
            reverses: null,
            corrects: null,
          },
        ],
      },
      {
        position: 2,
        product: {
          id: aceite.id,
          name: "Aceite de oliva virgen extra",
          baseUnit: "ml",
        },
        // As printed: 2 garrafas, each the supplier product's 5 l.
        quantity: "2",
        unit: "garrafa",
        unitPrice: "24.500000",
        discountPercent: null,
        vatRate: "10.00",
        storeroom: { id: dryStore.id, name: "Almacén" },
        movements: [
          expect.objectContaining({
            storeroom: { id: dryStore.id, name: "Almacén" },
            // €49.00 for 10 000 ml.
            quantity: 10_000,
            unitCost: "0.004900",
          }),
        ],
      },
    ]);
    expect(await stock(tomate.id, coldRoom.id)).toBe(5000);
    expect(await stock(aceite.id, dryStore.id)).toBe(10_000);

    const document = await getDocument(id);
    expect(document).toMatchObject({
      status: "posted",
      type: "delivery-note",
      supplier: { id: huerto.id },
      number: "ALB-0001",
      date: today(new Date()),
      reversal: null,
      copyOf: null,
      copy: null,
    });
    // Each stored line remembers the supplier product it was posted through.
    const lines = await db
      .select({ supplierProductId: documentLines.supplierProductId })
      .from(documentLines)
      .where(eq(documentLines.documentId, id))
      .orderBy(asc(documentLines.position));
    expect(lines).toEqual([
      { supplierProductId: tomateKilo.id },
      { supplierProductId: aceiteGarrafa.id },
    ]);
  });

  it("posts the draft as corrected in review, not as read", async () => {
    const id = await inReview();
    const corrected = printed();
    corrected.lines[0] = {
      ...corrected.lines[0]!,
      quantity: "4",
      lineTotal: "7.20",
    };
    corrected.totals = {
      net: "56.20",
      vat: [{ rate: "10", base: "56.20", amount: "5.62" }],
      total: "61.82",
    };
    const saved = await office.send(
      "PUT",
      `/api/documents/${id}/draft`,
      corrected,
    );
    expect(saved.statusCode, saved.body).toBe(200);

    const result = await posted(id);
    expect(result.lines[0]!.quantity).toBe("4");
    expect(await stock(tomate.id, coldRoom.id)).toBe(4000);
  });

  it("a line with no price is received at zero cost, until an invoice corrects it", async () => {
    const draft = printed();
    draft.totals = null;
    draft.lines = draft.lines.map((line) => ({
      ...line,
      unitPrice: null,
      lineTotal: null,
    }));
    const result = await posted(await inReview(draft));
    expect(result.lines.map((l) => l.movements[0]!.unitCost)).toEqual([
      "0.000000",
      "0.000000",
    ]);
  });

  it("a counter user posts only when nothing is left: not while the supplier is new", async () => {
    const counter = apiAs(app, await signedInAs(app, auth, "counter"));
    const id = await inReview();
    const before = await snapshot();
    await expectRefused(await post(id, STOREROOMS(), counter), 403, {
      error: "forbidden",
    });
    expect(await snapshot()).toEqual(before);

    await established();
    expect((await post(id, STOREROOMS(), counter)).statusCode).toBe(200);
  });

  it("refuses a document with something left that isn't a new supplier, for every role: 409 review_pending", async () => {
    const failed = await inReview(printed(), { failedChecks: true });
    const noSupplier = await inReview(printed(), { supplierId: null });
    const unmapped = await inReview({
      ...printed(),
      lines: [
        {
          ...printed().lines[0]!,
          supplierCode: "C-07",
          description: "Cebolla",
        },
      ],
    });
    const nothingRead = await inReview(null);
    const before = await snapshot();
    for (const id of [failed, noSupplier, unmapped, nothingRead]) {
      for (const api of [office, owner]) {
        await expectRefused(await post(id, { storerooms: [null] }, api), 409, {
          error: "review_pending",
        });
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it("an invoice from a supplier that has never posted a delivery note is received like one (#120); how invoices bill delivery notes is in src/billing", async () => {
    const id = await inReview({ ...printed(), documentType: "invoice" });
    const result = await posted(id);
    expect(result.lines.map((l) => l.movements.map((m) => m.kind))).toEqual([
      ["receipt"],
      ["receipt"],
    ]);
    expect(await stock(tomate.id, coldRoom.id)).toBe(5000);
  });

  it("refuses a document that isn't in review, and one that doesn't exist", async () => {
    const id = await inReview();
    await posted(id);
    await expectRefused(await post(id), 409, { error: "not_in_review" });
    const queued = await documentRead(db, {
      uploadedBy: officeId,
      status: "queued",
    });
    await expectRefused(await post(queued), 409, { error: "not_in_review" });
    expect((await post(MISSING)).statusCode).toBe(404);
  });

  it("a line with no storeroom of its own and none chosen is refused on that line, and nothing is posted", async () => {
    const id = await inReview();
    const before = await snapshot();
    await expectRefused(await post(id, { storerooms: [null, null] }), 409, {
      error: "cannot_post",
      fields: { "lines.1.storeroomId": "required" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("a return that would take stock below zero is refused on its line, and nothing is posted", async () => {
    const draft = printed();
    draft.totals = null;
    draft.lines[1] = {
      ...draft.lines[1]!,
      quantity: "-1",
      lineTotal: "-24.50",
    };
    const id = await inReview(draft);
    const before = await snapshot();
    await expectRefused(await post(id), 409, {
      error: "cannot_post",
      fields: { "lines.1.quantity": "below_zero" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("refuses storerooms that don't fit: one per line, each one of ours and active", async () => {
    const id = await inReview();
    await expectRefused(await post(id, { storerooms: [null] }), 400, {
      error: "invalid_input",
      fields: { storerooms: "invalid" },
    });
    await expectRefused(await post(id, { storerooms: [null, MISSING] }), 400, {
      error: "invalid_input",
      fields: { "storerooms.1": "not_found" },
    });
    await office.send("PATCH", `/api/storerooms/${dryStore.id}`, {
      active: false,
    });
    await expectRefused(await post(id), 400, {
      error: "invalid_input",
      fields: { "storerooms.1": "invalid" },
    });
  });
});

describe("POST /api/documents/:id/reverse", () => {
  it("the owner reverses a posted delivery note: its goods go out as they came in, dated today, and the document says it's reversed", async () => {
    const id = await inReview();
    await posted(id);
    const response = await reverse(id);
    expect(response.statusCode, response.body).toBe(200);
    const result = DocumentPosting.parse(response.json());

    expect(result.reversal).toEqual({
      id: expect.any(String),
      date: today(new Date()),
      reversedBy: { id: ownerId, name: "Test owner" },
      lines: [
        expect.objectContaining({
          position: 1,
          movements: [
            expect.objectContaining({
              quantity: -5000,
              unitCost: "0.001800",
              reverses: result.lines[0]!.movements[0]!.id,
            }),
          ],
        }),
        expect.objectContaining({
          position: 2,
          movements: [expect.objectContaining({ quantity: -10_000 })],
        }),
      ],
    });
    expect(await stock(tomate.id, coldRoom.id)).toBe(0);
    expect(await stock(aceite.id, dryStore.id)).toBe(0);

    expect(await getDocument(id)).toMatchObject({
      status: "posted",
      reversal: { id: result.reversal!.id, date: today(new Date()) },
    });
    expect(await postingOf(id)).toEqual(result);
  });

  it("refuses reversing twice, a document not posted, and anyone but the owner", async () => {
    const id = await inReview();
    await posted(id);
    await expectRefused(await reverse(id, office), 403, { error: "forbidden" });
    expect((await reverse(id)).statusCode).toBe(200);
    await expectRefused(await reverse(id), 409, { error: "already_reversed" });
    await expectRefused(await reverse(await inReview()), 409, {
      error: "not_posted",
    });
    expect((await reverse(MISSING)).statusCode).toBe(404);
  });

  it("refuses reversing a delivery note while an invoice that stands bills its lines (decision 0032): reverse the invoice first", async () => {
    const id = await inReview();
    const { lines } = await posted(id);
    const [line] = await db
      .select({ id: documentLines.id })
      .from(documentLines)
      .where(eq(documentLines.documentId, id))
      .orderBy(asc(documentLines.position));
    const invoice = await documentRead(db, { uploadedBy: officeId });
    const billed = await postDocument(
      db,
      { userId: officeId, requestId: "test" },
      invoice,
      {
        type: "invoice",
        supplierId: huerto.id,
        number: "F-1",
        date: today(new Date()),
        storeroomId: coldRoom.id,
        lines: [
          {
            productId: tomate.id,
            quantity: lines[0]!.quantity,
            unit: lines[0]!.unit,
            unitPrice: ledger.parseUnitCost("2.00"),
            billsLineId: line!.id,
          },
        ],
      },
    );
    expect(billed.ok).toBe(true);

    await expectRefused(await reverse(id), 409, { error: "billed" });
    await reverseDocument(db, { userId: ownerId, requestId: "test" }, invoice, {
      date: today(new Date()),
    });
    expect((await reverse(id)).statusCode).toBe(200);
  });
});

describe("POST /api/documents/:id/copy", () => {
  async function reversed() {
    const draft = printed();
    const id = await inReview(draft);
    const corrected = { ...draft, number: "ALB-0001-B" };
    await office.send("PUT", `/api/documents/${id}/draft`, corrected);
    await posted(id);
    expect((await reverse(id)).statusCode).toBe(200);
    return { id, draft, corrected };
  }

  it("the owner makes a corrected copy of a reversed document: in review, with what was read, the version posted, its supplier and its files", async () => {
    const { id, draft, corrected } = await reversed();
    const response = await copy(id);
    expect(response.statusCode, response.body).toBe(201);
    const made = Document.parse(response.json());

    const original = await getDocument(id);
    expect(made).toMatchObject({
      status: "ready_for_review",
      type: "delivery-note",
      supplier: { id: huerto.id },
      number: "ALB-0001-B",
      draft,
      corrected,
      // The original's number is no duplicate: that document is reversed.
      checkFailures: [],
      copyOf: id,
      copy: null,
      reversal: null,
      fileCount: 1,
      uploadedBy: { id: ownerId },
    });
    expect(made.files.map((f) => f.id)).toEqual(
      original.files.map((f) => f.id),
    );
    expect(original.copy).toBe(made.id);
  });

  it("the copy is reviewed and posted again: the stock is back", async () => {
    const { id } = await reversed();
    const made = Document.parse((await copy(id)).json());
    expect((await post(made.id)).statusCode).toBe(200);
    expect(await stock(tomate.id, coldRoom.id)).toBe(5000);
  });

  it("a copy of a copy, reversed in its turn, is still shown with the files first uploaded, and in the list too", async () => {
    const { id } = await reversed();
    const first = Document.parse((await copy(id)).json());
    await posted(first.id);
    expect((await reverse(first.id)).statusCode).toBe(200);
    const second = Document.parse((await copy(first.id)).json());

    const original = await getDocument(id);
    expect(second.copyOf).toBe(first.id);
    expect(second.files.map((f) => f.id)).toEqual(
      original.files.map((f) => f.id),
    );
    const list = await office.read(
      "/api/documents?status=ready_for_review",
      DocumentPage,
    );
    expect(list.items.find((d) => d.id === second.id)?.fileCount).toBe(1);
  });

  it("refuses a second copy, a document that isn't reversed, and anyone but the owner", async () => {
    const { id } = await reversed();
    await expectRefused(await copy(id, office), 403, { error: "forbidden" });
    expect((await copy(id)).statusCode).toBe(201);
    await expectRefused(await copy(id), 409, { error: "already_copied" });

    const standing = await inReview();
    await posted(standing);
    await expectRefused(await copy(standing), 409, { error: "not_reversed" });
    expect((await copy(MISSING)).statusCode).toBe(404);
  });
});

describe("GET /api/documents/:id/posting", () => {
  it("everyone signed in reads a posted document's lines and movements", async () => {
    const counter = apiAs(app, await signedInAs(app, auth, "counter"));
    const id = await inReview();
    const result = await posted(id);
    expect(await postingOf(id, counter)).toEqual(result);
  });

  it("a document that isn't posted has none: 409 not_posted", async () => {
    const response = await office.send(
      "GET",
      `/api/documents/${await inReview()}/posting`,
    );
    await expectRefused(response, 409, { error: "not_posted" });
  });
});

describe("the duplicate check, after a reversal", () => {
  it("a number from a reversed document isn't a duplicate; one from a document that stands is", async () => {
    const reversedOne = await inReview();
    await posted(reversedOne);
    await reverse(reversedOne);
    const again = await inReview();
    const checks = (id: string) =>
      office.send("POST", `/api/documents/${id}/draft/checks`, printed());
    expect((await checks(again)).json()).toEqual({ checkFailures: [] });

    await posted(again);
    expect((await checks(await inReview())).json()).toEqual({
      checkFailures: [{ check: "duplicate", path: "number" }],
    });
  });
});

describe("the audit log has every step of a document (#119)", () => {
  it("upload, supplier chosen, mapping confirmed, correction, post and reverse: each an entry about the document", async () => {
    // A supplier with no products yet, so a line is mapped by hand.
    const granja = await office.created(
      "/api/suppliers",
      { name: "Granja Los Robles, S.L.", taxId: syntheticCif(12) },
      Supplier,
    );
    const body = multipart([{ name: "1.jpg", bytes: sample.jpeg(119) }]);
    const uploaded = Document.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/documents",
          headers: { ...body.headers, cookie: officeCookie },
          payload: body.payload,
        })
      ).json(),
    );
    const id = uploaded.id;
    // Read, as the reading job leaves it: one line.
    const draft = { ...printed(), lines: [printed().lines[0]!] };
    draft.totals = null;
    await db
      .update(documents)
      .set({ status: "ready_for_review", draft, checkFailures: [] })
      .where(eq(documents.id, id));

    const steps = [
      await office.send("PUT", `/api/documents/${id}/supplier`, {
        supplierId: granja.id,
      }),
      await office.send("POST", `/api/documents/${id}/lines/1/mapping`, {
        productId: tomate.id,
        pack: { quantity: "1", unit: "kg" },
      }),
      await office.send("PUT", `/api/documents/${id}/draft`, {
        ...draft,
        lines: [{ ...draft.lines[0]!, quantity: "4", lineTotal: "7.20" }],
      }),
      await post(id, { storerooms: [null] }),
      await reverse(id),
    ];
    for (const step of steps)
      expect(step.statusCode, step.body).toBeLessThan(300);

    const entries = await db
      .select({
        action: auditLog.action,
        entityType: auditLog.entityType,
        requestId: auditLog.requestId,
      })
      .from(auditLog)
      .where(eq(auditLog.documentId, id))
      .orderBy(asc(auditLog.occurredAt), asc(auditLog.id));
    const reversalId = (await postingOf(id)).reversal!.id;
    const [reversalEntry] = await db
      .select({ action: auditLog.action, requestId: auditLog.requestId })
      .from(auditLog)
      .where(eq(auditLog.documentId, reversalId));
    expect([...entries, reversalEntry]).toEqual([
      {
        action: "create",
        entityType: "document",
        requestId: expect.any(String),
      },
      ...steps.slice(0, 4).map((step, i) => ({
        action: i === 1 ? "create" : "update",
        entityType: i === 1 ? "supplier_product" : "document",
        requestId: step.headers["x-request-id"],
      })),
      { action: "create", requestId: steps[4]!.headers["x-request-id"] },
    ]);
  });
});
