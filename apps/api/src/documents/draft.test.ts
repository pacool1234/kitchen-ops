import { MAX_AGE_DAYS, validate } from "@kitchen-ops/extract";
import {
  Document,
  DocumentMatching,
  DocumentPage,
  DraftChecks,
  MeResponse,
  Product,
  SavedDraft,
  Supplier,
  SupplierProduct,
  type ExtractedDocument,
} from "@kitchen-ops/shared";
import { eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createDb } from "../db/client";
import {
  auditLog,
  documentFiles,
  documents,
  products,
  suppliers,
  users,
} from "../db/schema";
import { fakeDocument, fakeMisread } from "../extraction/fake";
import { today } from "../extraction/read";
import { createMemoryStorage } from "../storage/memory";
import { signedInAs, signedInAsOwner } from "../test/auth";
import { apiAs, syntheticCif } from "../test/catalogue";
import { testConfig } from "../test/helpers";
import { documentRead, postedFrom } from "../test/matching";

// Correcting a document's draft in review (#118, decision 0037): the correction saved apart
// from what the model read, the checks run again on it, and a version checked without saving.
// Who may correct what is in corrections.test.ts, the audit entries in
// src/audit/writes-audited.test.ts.

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
let huerto: Supplier;
let granja: Supplier;

beforeEach(async () => {
  await db.execute(
    sql`truncate ${users}, ${documents}, ${products}, ${suppliers}, verifications cascade`,
  );
  const cookie = await signedInAs(app, auth, "office");
  office = apiAs(app, cookie);
  officeId = (await office.read("/api/me", MeResponse)).id;
  huerto = await office.created(
    "/api/suppliers",
    { name: "Frutas El Huerto, S.L.", taxId: syntheticCif(11) },
    Supplier,
  );
  granja = await office.created(
    "/api/suppliers",
    { name: "Granja Los Robles, S.L.", taxId: syntheticCif(12) },
    Supplier,
  );
});

/** What the fake model reads, dated today so the date check passes. */
const printed = () => fakeDocument(today(new Date()));
/** The same, with line 1's quantity misread: 50 kg for 5 (src/extraction/fake.ts). */
const misread = () => fakeMisread(today(new Date()));

/** A document in review, as the reading job leaves one that read `draft`: one photo of it. */
async function inReview(
  draft: ExtractedDocument | null,
  values: { supplierId?: string; failedChecks?: boolean } = {},
) {
  const id = await documentRead(db, { uploadedBy: officeId, draft, ...values });
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

const save = (id: string, draft: object, api = office) =>
  api.send("PUT", `/api/documents/${id}/draft`, draft);
const check = (id: string, draft: object, api = office) =>
  api.send("POST", `/api/documents/${id}/draft/checks`, draft);
const getDocument = (id: string) =>
  office.read(`/api/documents/${id}`, Document);
const matching = (id: string) =>
  office.read(`/api/documents/${id}/matching`, DocumentMatching);

/** Each failure as the API answers it: the check and its field, never its message. */
const failuresOf = (draft: ExtractedDocument, knownNumbers: string[] = []) =>
  validate(draft, {
    today: today(new Date()),
    maxAgeDays: MAX_AGE_DAYS,
    knownNumbers,
  }).failures.map(({ check, path }) => ({ check, path }));

const stored = async (id: string) =>
  (
    await db
      .select({ draft: documents.draft, corrected: documents.corrected })
      .from(documents)
      .where(eq(documents.id, id))
  )[0]!;

describe("PUT /api/documents/:id/draft", () => {
  it("saves the correction apart from what the model read: the document shows both, and the corrected one's checks", async () => {
    const id = await inReview(misread(), { failedChecks: true });
    expect((await getDocument(id)).checkFailures).toEqual([
      { check: "line-total", path: "lines.0.lineTotal" },
    ]);

    const response = await save(id, printed());
    expect(response.statusCode).toBe(200);
    expect(SavedDraft.parse(response.json())).toEqual({
      corrected: printed(),
      checkFailures: [],
    });

    const document = await getDocument(id);
    expect(document.draft).toEqual(misread());
    expect(document.corrected).toEqual(printed());
    expect(document.checkFailures).toEqual([]);
    expect(await stored(id)).toEqual({
      draft: misread(),
      corrected: printed(),
    });
  });

  it("runs the checks again on what's saved: a correction can fail them too", async () => {
    const id = await inReview(misread(), { failedChecks: true });
    const wrong = structuredClone(printed());
    wrong.lines[1]!.lineTotal = "48.00";
    const saved = SavedDraft.parse((await save(id, wrong)).json());
    expect(saved.checkFailures).toEqual(failuresOf(wrong));
    expect(saved.checkFailures).toContainEqual({
      check: "line-total",
      path: "lines.1.lineTotal",
    });
    expect((await getDocument(id)).checkFailures).toEqual(saved.checkFailures);
  });

  it("the header corrected is the document's: its type, number and date in the list", async () => {
    const id = await inReview(misread());
    const corrected = {
      ...printed(),
      documentType: "invoice" as const,
      number: "ALB-0002",
      issueDate: "2026-10-01",
    };
    expect((await save(id, corrected)).statusCode).toBe(200);
    const [listed] = (await office.read("/api/documents", DocumentPage)).items;
    expect(listed).toMatchObject({
      id,
      type: "invoice",
      number: "ALB-0002",
      date: "2026-10-01",
    });
  });

  it("a number already received from the document's supplier fails the duplicate check", async () => {
    await postedFrom(db, officeId, huerto.id, { number: "ALB-0009" });
    const id = await inReview(printed(), { supplierId: huerto.id });
    const saved = SavedDraft.parse(
      (await save(id, { ...printed(), number: "alb 0009" })).json(),
    );
    expect(saved.checkFailures).toEqual([
      { check: "duplicate", path: "number" },
    ]);
  });

  it("finds the supplier by the corrected tax ID if it has none, and never replaces one it has", async () => {
    const id = await inReview({
      ...printed(),
      supplier: { name: "Frutas El Huerto", taxId: "B12345678" },
    });
    expect((await matching(id)).supplier).toBeNull();

    const byTaxId = (taxId: string) => ({
      ...printed(),
      supplier: { name: "Frutas El Huerto", taxId },
    });
    expect((await save(id, byTaxId(huerto.taxId))).statusCode).toBe(200);
    expect((await matching(id)).supplier?.id).toBe(huerto.id);
    expect(
      (await office.read("/api/documents", DocumentPage)).items[0],
    ).toMatchObject({ supplier: { id: huerto.id } });

    // Another supplier's tax ID: the supplier stays the one it has.
    expect((await save(id, byTaxId(granja.taxId))).statusCode).toBe(200);
    expect((await matching(id)).supplier?.id).toBe(huerto.id);
  });

  it("a document the model couldn't read can be typed in: then it has lines, and a draft to post", async () => {
    const id = await inReview(null);
    expect((await matching(id)).reviewReasons).toContain("no_draft");

    expect((await save(id, printed())).statusCode).toBe(200);
    const after = await matching(id);
    expect(after.reviewReasons).not.toContain("no_draft");
    expect(after.lines).toHaveLength(printed().lines.length);
    expect((await getDocument(id)).draft).toBeNull();
  });

  it("refuses a draft the schema doesn't take, field by field, and saves nothing (400)", async () => {
    const id = await inReview(misread());
    const response = await save(id, {
      ...printed(),
      lines: [{ ...printed().lines[0], quantity: "5,5" }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_input",
      fields: { "lines.0.quantity": "invalid" },
    });
    expect((await save(id, { ...printed(), lines: [] })).statusCode).toBe(400);
    expect((await stored(id)).corrected).toBeNull();
  });

  it("refuses a document that isn't in review (409 not_in_review), and one that doesn't exist (404)", async () => {
    const failed = await documentRead(db, {
      uploadedBy: officeId,
      status: "failed",
    });
    const posted = await postedFrom(db, officeId, huerto.id);
    for (const id of [failed, posted]) {
      const response = await save(id, printed());
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: "not_in_review" });
      expect((await stored(id)).corrected).toBeNull();
    }
    expect((await save(MISSING, printed())).statusCode).toBe(404);
  });

  it("a counter user may correct a delivery note's quantities, and nothing else: 403, nothing saved (spec section 6)", async () => {
    const counter = apiAs(app, await signedInAs(app, auth, "counter"));
    const id = await inReview(misread(), { failedChecks: true });

    const otherUnit = structuredClone(printed());
    otherUnit.lines[0]!.unit = "caja";
    const refused = await save(id, otherUnit, counter);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: "forbidden" });
    expect((await stored(id)).corrected).toBeNull();

    // The quantity read as 50 is 5.
    expect((await save(id, printed(), counter)).statusCode).toBe(200);
    expect((await getDocument(id)).checkFailures).toEqual([]);

    const invoice = await inReview({ ...printed(), documentType: "invoice" });
    expect(
      (await save(invoice, { ...printed(), documentType: "invoice" }, counter))
        .statusCode,
    ).toBe(403);
    const unread = await inReview(null);
    expect((await save(unread, printed(), counter)).statusCode).toBe(403);
  });

  it("for any correction, what's saved is checked exactly as the checks endpoint checks it, with the supplier's numbers", async () => {
    await postedFrom(db, officeId, huerto.id, { number: "ALB-0009" });
    const id = await inReview(misread(), {
      supplierId: huerto.id,
      failedChecks: true,
    });
    const money = fc.stringMatching(/^\d{1,3}\.\d{2}$/);
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          quantity: fc.stringMatching(/^\d{1,2}(\.\d{1,3})?$/),
          lineTotal: money,
          net: money,
          number: fc.constantFrom("ALB-0001", "ALB-0009"),
        }),
        async ({ quantity, lineTotal, net, number }) => {
          const draft = structuredClone(printed());
          draft.number = number;
          draft.lines[0] = { ...draft.lines[0]!, quantity, lineTotal };
          draft.totals!.net = net;

          const checked = DraftChecks.parse((await check(id, draft)).json());
          const saved = SavedDraft.parse((await save(id, draft)).json());
          expect(saved.checkFailures).toEqual(checked.checkFailures);
          expect(saved.checkFailures).toEqual(failuresOf(draft, ["ALB-0009"]));
          expect((await getDocument(id)).checkFailures).toEqual(
            saved.checkFailures,
          );
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe("POST /api/documents/:id/draft/checks", () => {
  it("answers the checks a version would fail, and saves nothing", async () => {
    const id = await inReview(misread(), { failedChecks: true });
    const before = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id));

    const response = await check(id, misread());
    expect(response.statusCode).toBe(200);
    expect(DraftChecks.parse(response.json())).toEqual({
      checkFailures: [{ check: "line-total", path: "lines.0.lineTotal" }],
    });
    expect(
      DraftChecks.parse((await check(id, printed())).json()).checkFailures,
    ).toEqual([]);

    expect(
      await db.select().from(documents).where(eq(documents.id, id)),
    ).toEqual(before);
    expect(await db.select().from(auditLog)).not.toContainEqual(
      expect.objectContaining({ entityType: "document", entityId: id }),
    );
  });

  it("every role may check; it refuses what save refuses: a document not in review, one that doesn't exist, a draft the schema doesn't take", async () => {
    const id = await inReview(misread());
    for (const cookie of [
      await signedInAs(app, auth, "counter"),
      await signedInAsOwner(app, auth),
    ]) {
      expect((await check(id, printed(), apiAs(app, cookie))).statusCode).toBe(
        200,
      );
    }
    const posted = await postedFrom(db, officeId, huerto.id);
    expect((await check(posted, printed())).statusCode).toBe(409);
    expect((await check(MISSING, printed())).statusCode).toBe(404);
    expect((await check(id, { ...printed(), lines: [] })).statusCode).toBe(400);
  });
});

describe("matching reads the corrected draft (#117)", () => {
  let tomate: Product;
  beforeEach(async () => {
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
    await office.created(
      "/api/supplier-products",
      {
        supplierId: huerto.id,
        code: null,
        description: "Tomate pera, kilo",
        productId: tomate.id,
        pack: { quantity: "1", unit: "kg" },
      },
      SupplierProduct,
    );
  });

  const withLine = (supplierCode: string | null, description: string) => {
    const draft = printed();
    return {
      ...draft,
      lines: [{ ...draft.lines[0]!, supplierCode, description }],
    };
  };

  it("a description corrected to one the supplier has matches by it", async () => {
    const id = await inReview(withLine(null, "Tomate"), {
      supplierId: huerto.id,
    });
    expect((await matching(id)).lines[0]!.match).toBeNull();

    await save(id, withLine(null, "tomate pera, KILO"));
    expect((await matching(id)).lines[0]!.match).toMatchObject({
      by: "description",
    });
  });

  it("a line remembered is the corrected line: its code and description", async () => {
    const id = await inReview(withLine("C-0", "Cebolla"), {
      supplierId: huerto.id,
    });
    await save(id, withLine("C-07", "Cebolla dulce"));
    const response = await office.send(
      "POST",
      `/api/documents/${id}/lines/1/mapping`,
      { productId: tomate.id, pack: { quantity: "1", unit: "kg" } },
    );
    expect(response.statusCode).toBe(201);
    expect(
      DocumentMatching.parse(response.json()).lines[0]!.match,
    ).toMatchObject({
      by: "code",
      supplierProduct: { code: "C-07", description: "Cebolla dulce" },
    });
  });
});

describe("choosing the supplier runs the checks again (#117)", () => {
  it("a number already received from the supplier chosen fails the duplicate check", async () => {
    await postedFrom(db, officeId, huerto.id, { number: "ALB-0001" });
    const id = await inReview(printed());
    expect((await getDocument(id)).checkFailures).toEqual([]);

    const response = await office.send("PUT", `/api/documents/${id}/supplier`, {
      supplierId: huerto.id,
    });
    expect(response.statusCode).toBe(200);
    expect((await getDocument(id)).checkFailures).toEqual([
      { check: "duplicate", path: "number" },
    ]);
    expect(DocumentMatching.parse(response.json()).reviewReasons).toContain(
      "failed_checks",
    );
  });
});
