import * as ledger from "@kitchen-ops/ledger";
import {
  BillingCandidates,
  DocumentMatching,
  DocumentPosting,
  MeResponse,
  NEW_SUPPLIER_DOCUMENTS,
  Product,
  Storeroom,
  Supplier,
  SupplierProduct,
  type ExtractedDocument,
  type LineBillingChoice,
} from "@kitchen-ops/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import {
  auditLog,
  documentFiles,
  documents,
  invoiceLineBills,
  products,
  storerooms,
  suppliers,
  users,
} from "../db/schema";
import { fakeDocument } from "../extraction/fake";
import { today } from "../extraction/read";
import { movementsOf } from "../posting/stored";
import { createMemoryStorage } from "../storage/memory";
import { signedInAs, signedInAsOwner } from "../test/auth";
import { apiAs, syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";
import { documentRead, postedFrom } from "../test/matching";

// Invoices in review and posted (#120, decisions 0032 and 0041): each line suggested the
// delivery-note line it bills, confirmed or changed by office or the owner, or received with
// the invoice; the price differences; posting the corrections; credit notes; and reversing.

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
let owner: ReturnType<typeof apiAs>;
let counter: ReturnType<typeof apiAs>;
let coldRoom: Storeroom;
let dryStore: Storeroom;
let huerto: Supplier;
let tomate: Product;
let aceite: Product;

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${documents}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
  );
  office = apiAs(app, await signedInAs(app, auth, "office"));
  officeId = (await office.read("/api/me", MeResponse)).id;
  owner = apiAs(app, await signedInAsOwner(app, auth));
  counter = apiAs(app, await signedInAs(app, auth, "counter"));
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
  for (const offer of [
    {
      code: "T-01",
      description: "Tomate pera",
      productId: tomate.id,
      pack: { quantity: "1", unit: "kg" },
    },
    {
      code: null,
      description: "Aceite de oliva virgen extra 5 l",
      productId: aceite.id,
      pack: { quantity: "5", unit: "l" },
    },
  ]) {
    await office.created(
      "/api/supplier-products",
      { supplierId: huerto.id, ...offer },
      SupplierProduct,
    );
  }
  // Not new: its documents aren't held back for that.
  for (let i = 0; i < NEW_SUPPLIER_DOCUMENTS; i++) {
    await postedFrom(db, officeId, huerto.id, { number: `OLD-${i}` });
  }
});

/**
 * What the fake model reads, dated today: 5 kg of tomatoes (T-01) at €1.80, €9.00, and 2
 * garrafas of oil at €24.50, €49.00, matched by description.
 */
const printed = (): ExtractedDocument => fakeDocument(today(new Date()));

/** The same delivery note with another number and date. */
const noteNumbered = (number: string, date = today(new Date())) => ({
  ...printed(),
  number,
  issueDate: date,
});

/**
 * An invoice for that delivery note: the same lines at these prices, each line's total worked
 * out; it lists the delivery notes given.
 */
function invoiceFor(
  prices: readonly string[] = ["2.00", "24.50"],
  more: Partial<ExtractedDocument> = {},
): ExtractedDocument {
  const read = printed();
  return {
    ...read,
    documentType: "invoice",
    number: "F-1",
    deliveryNotes: ["ALB-0001"],
    lines: read.lines.map((line, i) => ({
      ...line,
      unitPrice: prices[i]!,
      lineTotal: ledger.formatMoney(
        ledger.lineTotal({
          quantity: line.quantity!,
          unitPrice: ledger.parseUnitCost(prices[i]!),
        }),
      ),
    })),
    ...more,
  };
}

/** A document in review from El Huerto, or another supplier, with one photo. */
async function inReview(
  draft: ExtractedDocument,
  supplierId: string | null = huerto.id,
) {
  const id = await documentRead(db, {
    uploadedBy: officeId,
    supplierId,
    draft,
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

const post = (id: string, storerooms: (string | null)[], api = office) =>
  api.send("POST", `/api/documents/${id}/post`, { storerooms });

async function posted(
  id: string,
  storerooms: (string | null)[] = [null, dryStore.id],
) {
  const response = await post(id, storerooms);
  expect(response.statusCode, response.body).toBe(200);
  return DocumentPosting.parse(response.json());
}

/** The fake model's delivery note, posted: tomatoes into the cold room, oil into the dry store. */
async function postedNote(draft: ExtractedDocument = printed()) {
  const id = await inReview(draft);
  await posted(id);
  return id;
}

const matchingOf = (id: string, api = office) =>
  api.read(`/api/documents/${id}/matching`, DocumentMatching);
const candidatesOf = (id: string, api = office) =>
  api.read(`/api/documents/${id}/billing/candidates`, BillingCandidates);
const confirm = (id: string, lines: LineBillingChoice[], api = office) =>
  api.send("PUT", `/api/documents/${id}/billing`, { lines });
const reverse = (id: string) =>
  owner.send("POST", `/api/documents/${id}/reverse`);

async function confirmed(id: string, lines: LineBillingChoice[]) {
  const response = await confirm(id, lines);
  expect(response.statusCode, response.body).toBe(200);
  return DocumentMatching.parse(response.json());
}

/** A delivery note's lines, by position, as candidates for this invoice. */
async function noteLines(invoiceId: string, noteId: string) {
  const { lines } = await candidatesOf(invoiceId);
  return lines
    .filter((l) => l.deliveryNote.id === noteId)
    .sort((a, b) => a.position - b.position);
}

/** Each of the invoice's lines billing the delivery note's line in the same position. */
async function billingAll(invoiceId: string, noteId: string) {
  const lines = await noteLines(invoiceId, noteId);
  return lines.map((l) => ({ deliveryNoteLineId: l.id }));
}

const average = async (productId: string, storeroomId: string) =>
  ledger.formatUnitCost(
    ledger.averageCost(
      await movementsOf(db, [productId]),
      productId,
      storeroomId,
    ),
  );
const stock = async (productId: string, storeroomId: string) =>
  ledger.stockOnHand(
    await movementsOf(db, [productId]),
    productId,
    storeroomId,
  );

describe("GET /api/documents/:id/matching, for an invoice", () => {
  it("suggests the delivery-note line each line bills, with its price now, the invoice's and the difference; a suggestion still waits to be confirmed", async () => {
    const note = await postedNote();
    const id = await inReview(invoiceFor());
    const matching = await matchingOf(id);
    const [tomatoes, oil] = await noteLines(id, note);

    expect(matching.lines.map((l) => l.billing)).toEqual([
      {
        by: "suggested",
        deliveryNoteLine: {
          id: tomatoes!.id,
          deliveryNote: {
            id: note,
            number: "ALB-0001",
            date: today(new Date()),
          },
          position: 1,
          product: { id: tomate.id, name: "Tomate pera", baseUnit: "g" },
          quantity: "5",
          unit: "kg",
          baseQuantity: 5000,
          unitCost: "0.001800",
        },
        // €10.00 for 5000 g, against €9.00 received.
        invoiceUnitCost: "0.002000",
        difference: "1.00",
        quantityMatches: true,
      },
      {
        by: "suggested",
        deliveryNoteLine: expect.objectContaining({ id: oil!.id }),
        invoiceUnitCost: "0.004900",
        difference: "0.00",
        quantityMatches: true,
      },
    ]);
    expect(matching.difference).toBe("1.00");
    expect(matching.reviewReasons).toEqual(["unbilled_lines"]);
  });

  it("a delivery note's lines bill nothing, and it has no difference", async () => {
    const id = await inReview(printed());
    const matching = await matchingOf(id);
    expect(matching.lines.map((l) => l.billing)).toEqual([null, null]);
    expect(matching.difference).toBeNull();
  });

  it("two delivery notes with the same lines: only the one the invoice lists is suggested, its number compared as the duplicate check does; without a list, neither", async () => {
    await postedNote(noteNumbered("ALB-0001"));
    const second = await postedNote(noteNumbered("ALB-0002"));
    const unlisted = await inReview(
      invoiceFor(undefined, { deliveryNotes: [] }),
    );
    expect((await matchingOf(unlisted)).lines.map((l) => l.billing)).toEqual([
      null,
      null,
    ]);

    const listed = await inReview(
      invoiceFor(undefined, { number: "F-2", deliveryNotes: ["alb 0002"] }),
    );
    const billed = (await matchingOf(listed)).lines.map((l) =>
      l.billing?.by === "suggested"
        ? l.billing.deliveryNoteLine.deliveryNote.id
        : null,
    );
    expect(billed).toEqual([second, second]);
  });

  it("without a listed number that matches, only delivery notes from the 62 days up to the invoice's date are suggested; an older one can still be chosen", async () => {
    const old = await postedNote(noteNumbered("ALB-0001", "2026-01-10"));
    const id = await inReview(invoiceFor(undefined, { deliveryNotes: [] }));
    expect((await matchingOf(id)).lines.map((l) => l.billing)).toEqual([
      null,
      null,
    ]);
    expect((await noteLines(id, old)).map((l) => l.position)).toEqual([1, 2]);
  });

  it("a line with a negative quantity is never suggested: a return bills nothing", async () => {
    await postedNote();
    const read = invoiceFor();
    const id = await inReview({
      ...read,
      lines: [{ ...read.lines[0]!, quantity: "-5", lineTotal: "-10.00" }],
    });
    expect((await matchingOf(id)).lines[0]!.billing).toBeNull();
  });

  it("an invoice-only supplier's lines start as received with the invoice: it has never posted a delivery note", async () => {
    const granja = await office.created(
      "/api/suppliers",
      { name: "Granja Los Robles, S.L.", taxId: syntheticCif(12) },
      Supplier,
    );
    await office.created(
      "/api/supplier-products",
      {
        supplierId: granja.id,
        code: "T-01",
        description: "Tomate pera",
        productId: tomate.id,
        pack: { quantity: "1", unit: "kg" },
      },
      SupplierProduct,
    );
    const read = invoiceFor();
    const id = await inReview({ ...read, lines: [read.lines[0]!] }, granja.id);
    const matching = await matchingOf(id);
    expect(matching.lines[0]!.billing).toEqual({ by: "received" });
    expect(matching.reviewReasons).toEqual(["new_supplier"]);
  });
});

describe("PUT /api/documents/:id/billing", () => {
  it("office confirms each line's delivery-note line: they're confirmed, nothing is left, and the candidates say which line has each", async () => {
    const note = await postedNote();
    const id = await inReview(invoiceFor());
    const matching = await confirmed(id, await billingAll(id, note));
    expect(matching.lines.map((l) => l.billing?.by)).toEqual([
      "confirmed",
      "confirmed",
    ]);
    expect(matching.reviewReasons).toEqual([]);
    expect((await noteLines(id, note)).map((l) => l.chosenFor)).toEqual([1, 2]);
  });

  it("a line received with the invoice needs its product, like a delivery note's; undoing a choice leaves the line unbilled", async () => {
    const note = await postedNote();
    const read = invoiceFor();
    const id = await inReview({
      ...read,
      lines: [
        read.lines[0]!,
        { ...read.lines[1]!, supplierCode: null, description: "Portes" },
      ],
    });
    const [tomatoes] = await billingAll(id, note);
    const matching = await confirmed(id, [
      { received: true },
      { received: true },
    ]);
    expect(matching.lines.map((l) => l.billing)).toEqual([
      { by: "received" },
      { by: "received" },
    ]);
    expect(matching.reviewReasons).toEqual(["unmapped_lines"]);

    const undone = await confirmed(id, [tomatoes!, null]);
    expect(undone.lines.map((l) => l.billing?.by ?? null)).toEqual([
      "confirmed",
      null,
    ]);
    expect(undone.reviewReasons).toEqual(["unbilled_lines"]);
  });

  it("a line billing another quantity than its delivery note received: no price compared, and posting waits", async () => {
    const note = await postedNote();
    const read = invoiceFor();
    const id = await inReview({
      ...read,
      lines: [{ ...read.lines[0]!, quantity: "4", lineTotal: "8.00" }],
    });
    const [tomatoes] = await billingAll(id, note);
    const matching = await confirmed(id, [tomatoes!]);
    expect(matching.lines[0]!.billing).toMatchObject({
      by: "confirmed",
      quantityMatches: false,
      invoiceUnitCost: null,
      difference: null,
    });
    expect(matching.reviewReasons).toEqual(["quantity_differs"]);
  });

  it("is audited with the document: each choice made, changed or undone", async () => {
    const note = await postedNote();
    const id = await inReview(invoiceFor());
    const [tomatoes, oil] = await billingAll(id, note);
    await confirmed(id, [tomatoes!, oil!]);
    await confirmed(id, [{ received: true }, null]);
    const entries = await db
      .select({
        action: auditLog.action,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "invoice_line_bill"),
          eq(auditLog.documentId, id),
        ),
      )
      .orderBy(asc(auditLog.id));
    expect(entries).toEqual([
      {
        action: "create",
        before: null,
        after: {
          position: 1,
          deliveryNoteLineId: tomatoes!.deliveryNoteLineId,
          received: false,
        },
      },
      {
        action: "create",
        before: null,
        after: {
          position: 2,
          deliveryNoteLineId: oil!.deliveryNoteLineId,
          received: false,
        },
      },
      {
        action: "update",
        before: {
          position: 1,
          deliveryNoteLineId: tomatoes!.deliveryNoteLineId,
          received: false,
        },
        after: { position: 1, deliveryNoteLineId: null, received: true },
      },
      {
        action: "delete",
        before: {
          position: 2,
          deliveryNoteLineId: oil!.deliveryNoteLineId,
          received: false,
        },
        after: null,
      },
    ]);
  });

  it("refuses: a counter user (403), a delivery note (409), the wrong number of lines (400), a line that isn't a candidate (400), one line for two (409); and saves nothing", async () => {
    const note = await postedNote();
    const id = await inReview(invoiceFor());
    const [tomatoes] = await billingAll(id, note);

    expect((await confirm(id, [tomatoes!, null], counter)).statusCode).toBe(
      403,
    );
    const delivery = await inReview(printed());
    const notInvoice = await confirm(delivery, [null, null]);
    expect(notInvoice.statusCode).toBe(409);
    expect(notInvoice.json()).toEqual({ error: "not_an_invoice" });

    const short = await confirm(id, [tomatoes!]);
    expect(short.statusCode).toBe(400);
    expect(short.json()).toEqual({
      error: "invalid_input",
      fields: { lines: "invalid" },
    });
    const unknown = await confirm(id, [{ deliveryNoteLineId: MISSING }, null]);
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toEqual({
      error: "invalid_input",
      fields: { "lines.0": "not_found" },
    });
    const twice = await confirm(id, [tomatoes!, tomatoes!]);
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toEqual({
      error: "conflict",
      fields: { "lines.1": "taken" },
    });
    expect(await db.select().from(invoiceLineBills)).toEqual([]);
    expect((await confirm(MISSING, [])).statusCode).toBe(404);
  });

  it("a line a standing invoice bills already is refused (409 taken) and no longer a candidate; a credit note may bill it again", async () => {
    const note = await postedNote();
    const first = await inReview(invoiceFor());
    const lines = await billingAll(first, note);
    await confirmed(first, lines);
    await posted(first, [null, null]);

    const second = await inReview(invoiceFor(undefined, { number: "F-2" }));
    expect(await noteLines(second, note)).toEqual([]);
    const again = await confirm(second, lines);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({
      error: "conflict",
      fields: { "lines.0": "taken", "lines.1": "taken" },
    });

    const read = invoiceFor(["-0.10"]);
    const credit = await inReview({
      ...read,
      number: "R-1",
      totals: { net: "-0.50", vat: [], total: "-0.55" },
      lines: [{ ...read.lines[0]!, lineTotal: "-0.50" }],
    });
    expect((await confirm(credit, [lines[0]!])).statusCode).toBe(200);
  });
});

describe("POST /api/documents/:id/post, for an invoice", () => {
  it("office posts it: the line at a new price is corrected, the one at the same price posts nothing; stock stays, and the average cost is as if the delivery note had shown the invoice's price", async () => {
    const note = await postedNote();
    const id = await inReview(invoiceFor());
    await confirmed(id, await billingAll(id, note));
    expect(await average(tomate.id, coldRoom.id)).toBe("0.001800");

    const result = await posted(id, [null, null]);
    expect(result.lines.map((l) => l.movements.map((m) => m.kind))).toEqual([
      ["receipt", "receipt"],
      [],
    ]);
    expect(result.lines[0]!.storeroom).toBeNull();
    expect(await stock(tomate.id, coldRoom.id)).toBe(5000);
    expect(await average(tomate.id, coldRoom.id)).toBe("0.002000");
    expect(await average(aceite.id, dryStore.id)).toBe("0.004900");
    const [row] = await db
      .select({ status: documents.status, type: documents.type })
      .from(documents)
      .where(eq(documents.id, id));
    expect(row).toEqual({ status: "posted", type: "invoice" });
  });

  it("a counter user may not post an invoice, even with nothing left (403); nor may anyone while a line is unbilled (409)", async () => {
    const note = await postedNote();
    const id = await inReview(invoiceFor());
    const pending = await post(id, [null, null]);
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toEqual({ error: "review_pending" });
    await confirmed(id, await billingAll(id, note));
    const forCounter = await post(id, [null, null], counter);
    expect(forCounter.statusCode).toBe(403);
    expect(forCounter.json()).toEqual({ error: "forbidden" });
  });

  it("another invoice posted meanwhile billing the same line: refused, 409 already_billed on its field, and nothing written", async () => {
    const note = await postedNote();
    const first = await inReview(invoiceFor());
    const second = await inReview(
      invoiceFor(["2.10", "24.50"], { number: "F-2" }),
    );
    const lines = await billingAll(first, note);
    await confirmed(first, lines);
    await confirmed(second, lines);
    await posted(first, [null, null]);

    const refused = await post(second, [null, null]);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({
      error: "already_billed",
      fields: { "lines.0": "taken", "lines.1": "taken" },
    });
    expect(await average(tomate.id, coldRoom.id)).toBe("0.002000");
  });

  it("an invoice-only supplier's invoice receives its lines like a delivery note", async () => {
    const granja = await office.created(
      "/api/suppliers",
      { name: "Granja Los Robles, S.L.", taxId: syntheticCif(12) },
      Supplier,
    );
    await office.created(
      "/api/supplier-products",
      {
        supplierId: granja.id,
        code: "T-01",
        description: "Tomate pera",
        productId: tomate.id,
        pack: { quantity: "1", unit: "kg" },
      },
      SupplierProduct,
    );
    const read = invoiceFor();
    const id = await inReview({ ...read, lines: [read.lines[0]!] }, granja.id);
    const result = await posted(id, [null]);
    expect(result.lines[0]!.storeroom).toEqual({
      id: coldRoom.id,
      name: "Cámara",
    });
    expect(await stock(tomate.id, coldRoom.id)).toBe(5000);
    expect(await average(tomate.id, coldRoom.id)).toBe("0.002000");
  });

  it("a credit note's negative price on a line it bills is a difference: posted on top of the line's price now, €2.00 − €0.10 = €1.90 a kg", async () => {
    const note = await postedNote();
    const first = await inReview(invoiceFor());
    const lines = await billingAll(first, note);
    await confirmed(first, lines);
    await posted(first, [null, null]);

    const read = invoiceFor(["-0.10"]);
    const credit = await inReview({
      ...read,
      number: "R-1",
      totals: { net: "-0.50", vat: [], total: "-0.55" },
      lines: [{ ...read.lines[0]!, lineTotal: "-0.50" }],
    });
    const matching = await confirmed(credit, [lines[0]!]);
    expect(matching.lines[0]!.billing).toMatchObject({
      by: "confirmed",
      deliveryNoteLine: { unitCost: "0.002000" },
      invoiceUnitCost: "0.001900",
      difference: "-0.50",
    });
    await posted(credit, [null]);
    expect(await average(tomate.id, coldRoom.id)).toBe("0.001900");
    expect(await stock(tomate.id, coldRoom.id)).toBe(5000);
  });

  it("a credit note's negative quantity received with it is a return: out of the storeroom chosen", async () => {
    await postedNote();
    const read = invoiceFor();
    const id = await inReview({
      ...read,
      number: "R-2",
      totals: { net: "-4.00", vat: [], total: "-4.40" },
      lines: [{ ...read.lines[0]!, quantity: "-2", lineTotal: "-4.00" }],
    });
    await confirmed(id, [{ received: true }]);
    await posted(id, [coldRoom.id]);
    expect(await stock(tomate.id, coldRoom.id)).toBe(3000);
  });
});

describe("corrections in review keep or clear an invoice's choices", () => {
  it("a correction that changes a price keeps them; one that removes a line clears them, audited", async () => {
    const note = await postedNote();
    const id = await inReview(invoiceFor());
    await confirmed(id, await billingAll(id, note));

    const repriced = invoiceFor(["2.10", "24.50"]);
    expect(
      (await office.send("PUT", `/api/documents/${id}/draft`, repriced))
        .statusCode,
    ).toBe(200);
    expect((await matchingOf(id)).lines.map((l) => l.billing?.by)).toEqual([
      "confirmed",
      "confirmed",
    ]);

    const shorter = { ...repriced, lines: [repriced.lines[0]!] };
    expect(
      (await office.send("PUT", `/api/documents/${id}/draft`, shorter))
        .statusCode,
    ).toBe(200);
    expect((await matchingOf(id)).lines.map((l) => l.billing?.by)).toEqual([
      "suggested",
    ]);
    expect(await db.select().from(invoiceLineBills)).toEqual([]);
    const cleared = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.entityType, "invoice_line_bill"));
    expect(cleared.filter((e) => e.action === "delete")).toHaveLength(2);
  });
});

describe("reversing an invoice", () => {
  it("puts the delivery note's price back; refused (409 billed) while a later invoice's correction stands on its lines", async () => {
    const note = await postedNote();
    const first = await inReview(invoiceFor());
    const lines = await billingAll(first, note);
    await confirmed(first, lines);
    await posted(first, [null, null]);

    const read = invoiceFor(["-0.10"]);
    const credit = await inReview({
      ...read,
      number: "R-1",
      totals: { net: "-0.50", vat: [], total: "-0.55" },
      lines: [{ ...read.lines[0]!, lineTotal: "-0.50" }],
    });
    await confirmed(credit, [lines[0]!]);
    await posted(credit, [null]);

    const blocked = await reverse(first);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ error: "billed" });

    expect((await reverse(credit)).statusCode).toBe(200);
    expect(await average(tomate.id, coldRoom.id)).toBe("0.002000");
    expect((await reverse(first)).statusCode).toBe(200);
    expect(await average(tomate.id, coldRoom.id)).toBe("0.001800");
    expect(await stock(tomate.id, coldRoom.id)).toBe(5000);
  });
});

describe("invoice properties, through the API", () => {
  it("for any new prices, the total difference is the lines' added up, each the invoice's line total less what the delivery note received at its price now; after posting, the average cost is the invoice's", async () => {
    const price = fc
      .integer({ min: 1, max: 9_999 })
      .map((cents) => ledger.formatMoney(ledger.moneyFromCents(BigInt(cents))));
    await fc.assert(
      fc.asyncProperty(price, price, async (tomatoes, oil) => {
        await db.execute(sql`truncate ${documents} cascade`);
        for (let i = 0; i < NEW_SUPPLIER_DOCUMENTS; i++) {
          await postedFrom(db, officeId, huerto.id, { number: `OLD-${i}` });
        }
        const note = await postedNote();
        const draft = invoiceFor([tomatoes, oil]);
        const id = await inReview(draft);
        const matching = await confirmed(id, await billingAll(id, note));
        const expected = [
          ledger.subtractMoney(
            ledger.parseMoney(draft.lines[0]!.lineTotal!),
            ledger.parseMoney("9.00"),
          ),
          ledger.subtractMoney(
            ledger.parseMoney(draft.lines[1]!.lineTotal!),
            ledger.parseMoney("49.00"),
          ),
        ];
        expect(
          matching.lines.map(
            (l) => l.billing?.by === "confirmed" && l.billing.difference,
          ),
        ).toEqual(expected.map(ledger.formatMoney));
        expect(matching.difference).toBe(
          ledger.formatMoney(ledger.sumMoney(expected)),
        );

        await posted(id, [null, null]);
        expect(await average(tomate.id, coldRoom.id)).toBe(
          ledger.formatUnitCost(
            ledger.receivedUnitCost(
              ledger.parseMoney(draft.lines[0]!.lineTotal!),
              5000,
            ),
          ),
        );
        expect(await stock(tomate.id, coldRoom.id)).toBe(5000);
      }),
      { numRuns: 8 },
    );
  });
});
