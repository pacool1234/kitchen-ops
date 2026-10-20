import { parseUnitCost, stockOnHand } from "@kitchen-ops/ledger";
import { randomUUIDv7 } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import { auditLog, documentLines, documents, movements } from "../db/schema";
import { testConfig } from "../test/helpers";
import {
  documentToReview,
  reviewed,
  reviewedLine,
  setUpCatalogue,
  type PostingCatalogue,
} from "../test/posting";
import { postDocument, reverseDocument } from "./posting";
import { movementsOf } from "./stored";

// Posting reviewed documents into stored movements, and reversing them (#116, decision 0034).

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
afterAll(close);

let c: PostingCatalogue;
beforeEach(async () => {
  c = await setUpCatalogue(db, auth);
});

const context = () => ({ userId: c.userId, requestId: "request-1" });

/** 1.5 boxes of tomatoes at €12.00 a box, 5% off, into the cold room; 2 dozen eggs into the dry store. */
const delivery = () =>
  reviewed(c, [
    reviewedLine(c.tomatoes, "1.5", "box", "12.00", {
      discountPercent: "5",
      vatRate: "4",
    }),
    reviewedLine(c.eggs, "2", "dozen", "2.40", { storeroomId: c.dryStore }),
  ]);

async function posted(documentId: string, document = delivery()) {
  const result = await postDocument(db, context(), documentId, document);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}

const linesOf = (documentId: string) =>
  db
    .select()
    .from(documentLines)
    .where(eq(documentLines.documentId, documentId))
    .orderBy(asc(documentLines.position));

/** Everything posting can write, to compare before and after. */
async function snapshot() {
  const [d, l, m, a] = await Promise.all([
    db.select().from(documents).orderBy(asc(documents.id)),
    db.select().from(documentLines).orderBy(asc(documentLines.id)),
    db.select().from(movements).orderBy(asc(movements.sequence)),
    db.select().from(auditLog).orderBy(asc(auditLog.id)),
  ]);
  return { d, l, m, a };
}

/** Refused by the database: Drizzle wraps Postgres's error, so look in its cause too. */
async function expectRefused(write: Promise<unknown>, reason: RegExp) {
  const error = await write.then(
    () => null,
    (e: unknown) => e as Error & { cause?: unknown },
  );
  expect(error, "the database accepted it").not.toBeNull();
  expect(`${error!.message} ${String(error!.cause)}`).toMatch(reason);
}

describe("postDocument: a reviewed delivery note into stock", () => {
  it("stores its lines and movements, posts the document with its reviewed header, and records one audit entry", async () => {
    const id = await documentToReview(db, c);
    const result = await posted(id);

    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id));
    expect(document).toMatchObject({
      status: "posted",
      type: "delivery-note",
      supplierId: c.supplier,
      number: "A-1",
      date: "2026-10-20",
      reverses: null,
    });

    const lines = await linesOf(id);
    expect(lines).toMatchObject([
      {
        position: 1,
        productId: c.tomatoes,
        quantity: "1.500000",
        unit: "box",
        unitPrice: "12.000000",
        discountPercent: "5.00",
        vatRate: "4.00",
        storeroomId: c.coldRoom,
        billsLineId: null,
        adjustment: false,
      },
      {
        position: 2,
        productId: c.eggs,
        quantity: "2.000000",
        unit: "dozen",
        unitPrice: "2.400000",
        discountPercent: null,
        vatRate: null,
        storeroomId: c.dryStore,
      },
    ]);

    // €17.10 for 9000 g: €0.0019 a gram. €4.80 for 24 000 thousandths: €0.0002.
    const stored = await movementsOf(db);
    expect(stored).toEqual(result.movements);
    expect(stored).toEqual([
      {
        id: expect.any(String),
        productId: c.tomatoes,
        storeroomId: c.coldRoom,
        quantity: 9000,
        unitCost: parseUnitCost("0.0019"),
        documentLineId: lines[0]!.id,
        kind: "receipt",
      },
      {
        id: expect.any(String),
        productId: c.eggs,
        storeroomId: c.dryStore,
        quantity: 24_000,
        unitCost: parseUnitCost("0.0002"),
        documentLineId: lines[1]!.id,
        kind: "receipt",
      },
    ]);

    expect(await db.select().from(auditLog)).toEqual([
      expect.objectContaining({
        userId: c.userId,
        requestId: "request-1",
        action: "update",
        entityType: "document",
        entityId: id,
        documentId: id,
        changes: expect.objectContaining({
          status: { before: "ready_for_review", after: "posted" },
        }),
      }),
    ]);
  });

  it("an invoice corrects a posted delivery note's price: its correcting receipt and the reversal are stored, linked to the receipt they replace", async () => {
    const note = await documentToReview(db, c);
    await posted(
      note,
      reviewed(c, [reviewedLine(c.tomatoes, "10", "kg", "1.80")]),
    );
    const [billed] = await linesOf(note);
    const invoice = await documentToReview(db, c);
    const result = await posted(
      invoice,
      reviewed(
        c,
        [
          reviewedLine(c.tomatoes, "10", "kg", "2.00", {
            billsLineId: billed!.id,
          }),
        ],
        { type: "invoice", number: "F-1", date: "2026-10-31" },
      ),
    );

    const [receipt] = await db
      .select()
      .from(movements)
      .where(eq(movements.documentLineId, billed!.id));
    const [line] = await linesOf(invoice);
    expect(line).toMatchObject({ billsLineId: billed!.id, storeroomId: null });
    expect(result.movements).toMatchObject([
      {
        quantity: 10_000,
        unitCost: parseUnitCost("0.002"),
        corrects: receipt!.id,
        documentLineId: line!.id,
      },
      {
        quantity: -10_000,
        unitCost: parseUnitCost("0.0018"),
        reverses: receipt!.id,
        documentLineId: line!.id,
      },
    ]);
    expect((await movementsOf(db)).slice(1)).toEqual(result.movements);
  });

  it("refuses a document that isn't ready for review, or doesn't exist, and writes nothing", async () => {
    const queued = await documentToReview(db, c, "queued");
    const done = await documentToReview(db, c);
    await posted(done);
    const before = await snapshot();

    expect(await postDocument(db, context(), queued, delivery())).toEqual({
      ok: false,
      reason: "not_ready",
    });
    expect(await postDocument(db, context(), done, delivery())).toEqual({
      ok: false,
      reason: "not_ready",
    });
    expect(
      await postDocument(db, context(), randomUUIDv7(), delivery()),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await snapshot()).toEqual(before);
  });

  it("a line that can't be posted posts nothing, and is named by its position", async () => {
    const id = await documentToReview(db, c);
    const before = await snapshot();
    const result = await postDocument(
      db,
      context(),
      id,
      reviewed(c, [
        reviewedLine(c.tomatoes, "1", "kg", "2.00"),
        reviewedLine(c.tomatoes, "1", "crate", "2.00"),
      ]),
    );
    expect(result).toEqual({
      ok: false,
      reason: "lines",
      errors: [{ line: 2, message: expect.stringContaining("crate") }],
    });
    expect(await snapshot()).toEqual(before);
  });

  it("two postings of the same document at once post it once", async () => {
    const id = await documentToReview(db, c);
    const results = await Promise.all([
      postDocument(db, context(), id, delivery()),
      postDocument(db, context(), id, delivery()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: "not_ready" },
    ]);
    expect(await movementsOf(db)).toHaveLength(2);
  });

  it("two documents posted at once each check the stock the other left: 10 kg on hand, two returns of 6 kg, only one passes (invariant 6)", async () => {
    await posted(
      await documentToReview(db, c),
      reviewed(c, [reviewedLine(c.tomatoes, "10", "kg", "1.80")]),
    );
    const returnOf6 = () =>
      reviewed(c, [reviewedLine(c.tomatoes, "-6", "kg", "1.80")]);
    const [a, b] = [
      await documentToReview(db, c),
      await documentToReview(db, c),
    ];
    const results = await Promise.all([
      postDocument(db, context(), a, returnOf6()),
      postDocument(db, context(), b, returnOf6()),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(stockOnHand(await movementsOf(db), c.tomatoes, c.coldRoom)).toBe(
      4000,
    );
  });
});

describe("reverseDocument: a posted document's reversal, stored", () => {
  it("is a posted document of its own, reversing the original, with copies of its lines and a reversing movement for each, and one audit entry creating it", async () => {
    const id = await documentToReview(db, c);
    const original = await posted(id);
    const before = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id));

    const result = await reverseDocument(db, context(), id, {
      date: "2026-10-21",
    });
    if (!result.ok) throw new Error(JSON.stringify(result));

    const [reversal] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, result.documentId));
    expect(reversal).toMatchObject({
      status: "posted",
      reverses: id,
      type: "delivery-note",
      supplierId: c.supplier,
      number: "A-1",
      date: "2026-10-21",
      uploadedBy: c.userId,
    });
    expect(
      await db.select().from(documents).where(eq(documents.id, id)),
    ).toEqual(before);

    const [originalLines, copies] = await Promise.all([
      linesOf(id),
      linesOf(result.documentId),
    ]);
    expect(copies.map(({ id: _, documentId: __, ...l }) => l)).toEqual(
      originalLines.map(({ id: _, documentId: __, ...l }) => l),
    );

    const stored = await movementsOf(db);
    expect(stored.slice(2)).toEqual(result.movements);
    // Last first, as the ledger reverses.
    expect(result.movements).toMatchObject([
      { reverses: original.movements[1]!.id, documentLineId: copies[1]!.id },
      { reverses: original.movements[0]!.id, documentLineId: copies[0]!.id },
    ]);
    expect(stockOnHand(stored, c.tomatoes, c.coldRoom)).toBe(0);
    expect(stockOnHand(stored, c.eggs, c.dryStore)).toBe(0);

    expect(
      await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.entityId, result.documentId)),
    ).toEqual([
      expect.objectContaining({
        action: "create",
        entityType: "document",
        documentId: result.documentId,
        changes: expect.objectContaining({
          reverses: { before: null, after: id },
          status: { before: null, after: "posted" },
        }),
      }),
    ]);
  });

  it("refuses reversing a document twice, one that isn't posted, a reversal, or one that doesn't exist, and writes nothing", async () => {
    const id = await documentToReview(db, c);
    await posted(id);
    const first = await reverseDocument(db, context(), id, {
      date: "2026-10-21",
    });
    if (!first.ok) throw new Error(JSON.stringify(first));
    const unposted = await documentToReview(db, c);
    const before = await snapshot();
    const reverse = (documentId: string) =>
      reverseDocument(db, context(), documentId, { date: "2026-10-22" });

    expect(await reverse(id)).toEqual({
      ok: false,
      reason: "already_reversed",
    });
    expect(await reverse(unposted)).toEqual({
      ok: false,
      reason: "not_posted",
    });
    expect(await reverse(first.documentId)).toEqual({
      ok: false,
      reason: "is_reversal",
    });
    expect(await reverse(randomUUIDv7())).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await snapshot()).toEqual(before);
  });

  it("a delivery note whose goods were used can't be reversed: its line is named, and nothing is written", async () => {
    const id = await documentToReview(db, c);
    await posted(
      id,
      reviewed(c, [reviewedLine(c.tomatoes, "10", "kg", "1.80")]),
    );
    await posted(
      await documentToReview(db, c),
      reviewed(c, [reviewedLine(c.tomatoes, "-6", "kg", "1.80")]),
    );
    const before = await snapshot();
    expect(
      await reverseDocument(db, context(), id, { date: "2026-10-21" }),
    ).toEqual({
      ok: false,
      reason: "lines",
      errors: [{ line: 1, message: expect.stringContaining("-6000") }],
    });
    expect(await snapshot()).toEqual(before);
  });
});

describe("the database keeps posted records as they are (decision 0034)", () => {
  it("refuses changing or deleting a movement or a posted line", async () => {
    const id = await documentToReview(db, c);
    await posted(id);
    await expectRefused(
      db.execute(sql`update ${movements} set quantity = 1`),
      /movements is append-only: UPDATE/,
    );
    await expectRefused(
      db.execute(sql`delete from ${movements}`),
      /movements is append-only: DELETE/,
    );
    await expectRefused(
      db.execute(sql`update ${documentLines} set unit = 'kg'`),
      /document_lines is append-only: UPDATE/,
    );
    await expectRefused(
      db.execute(sql`delete from ${documentLines}`),
      /document_lines is append-only: DELETE/,
    );
  });

  it("refuses changing or deleting a posted document, but not one still in review", async () => {
    const id = await documentToReview(db, c);
    const inReview = await documentToReview(db, c);
    await posted(id);
    await expectRefused(
      db.update(documents).set({ number: "B-2" }).where(eq(documents.id, id)),
      /is posted: UPDATE/,
    );
    await expectRefused(
      db.delete(documents).where(eq(documents.id, id)),
      /is posted: DELETE/,
    );
    await db
      .update(documents)
      .set({ number: "B-2" })
      .where(eq(documents.id, inReview));
  });

  it("refuses a second movement reversing the same one, and a second reversal of the same document", async () => {
    const id = await documentToReview(db, c);
    const original = await posted(id);
    const first = await reverseDocument(db, context(), id, {
      date: "2026-10-21",
    });
    if (!first.ok) throw new Error(JSON.stringify(first));
    const [copy] = await linesOf(first.documentId);
    await expectRefused(
      db.insert(movements).values({
        id: randomUUIDv7(),
        productId: c.tomatoes,
        storeroomId: c.coldRoom,
        quantity: -9000,
        unitCost: "0.001900",
        documentLineId: copy!.id,
        kind: "receipt",
        reverses: original.movements[0]!.id,
      }),
      /movements_reverses_unique/,
    );
    await expectRefused(
      db.insert(documents).values({
        status: "posted",
        type: "delivery-note",
        supplierId: c.supplier,
        date: "2026-10-22",
        reverses: id,
        uploadedBy: c.userId,
      }),
      /documents_reverses_unique/,
    );
  });

  it("a unit cost comes back exactly, from €0.000001 (€0.01 for 10 kg) to the column's largest, €999 999 999 999.999999", async () => {
    const id = await documentToReview(db, c);
    await posted(
      id,
      reviewed(c, [reviewedLine(c.tomatoes, "10", "kg", "0.001")]),
    );
    const [line] = await linesOf(id);
    await db.insert(movements).values({
      id: randomUUIDv7(),
      productId: c.tomatoes,
      storeroomId: c.coldRoom,
      quantity: 1,
      unitCost: "999999999999.999999",
      documentLineId: line!.id,
      kind: "receipt",
    });
    expect((await movementsOf(db)).map((m) => m.unitCost)).toEqual([
      1n,
      999_999_999_999_999_999n,
    ]);
  });
});
