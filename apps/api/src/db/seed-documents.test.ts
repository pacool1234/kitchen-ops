import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import {
  DocumentMatching,
  ProductStock,
  ExtractedDocument,
} from "@kitchen-ops/shared";
import { count, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createAuth } from "../auth/auth";
import { createUser } from "../auth/users";
import { checked } from "../extraction/read";
import { readMatching } from "../matching/matching";
import { createMemoryStorage } from "../storage/memory";
import type { Storage } from "../storage/storage";
import { signedInAs, TEST_PASSWORD } from "../test/auth";
import { apiAs } from "../test/catalogue";
import { testConfig } from "../test/helpers";
import { createDb } from "./client";
import {
  documentFiles,
  documents,
  products,
  storerooms,
  supplierProducts,
  suppliers,
  unitConversions,
  users,
} from "./schema";
import {
  DEMO_DOCUMENTS,
  DEMO_UPLOADER,
  demoProducts,
  demoSupplierProducts,
  demoSuppliers,
} from "./seed-documents";
import { seedProducts, seedSuppliers } from "./seed-catalogue";
import { planSeed } from "./seed-plan";
import { runSeed } from "./seed-run";

// Staging's demo documents (#119, decision 0039): seeded by their fixed IDs, on a database that
// may have a catalogue and documents of its own already. Each one is what reading it would give.
// The fourth is the invoice for the first, a delivery note (#120).

const config = testConfig();
const { db, close } = createDb(config.DATABASE_URL);
afterAll(close);

const auth = createAuth(db, config);
const local = planSeed({ NODE_ENV: "test" });
const NOW = new Date("2026-10-21T10:00:00Z");
const ids = DEMO_DOCUMENTS.map((d) => d.id);

const lines: string[] = [];
const log = (line: string) => lines.push(line);
const seed = (storage: Storage | null) =>
  runSeed(db, auth, local, storage, log, NOW);

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** A gold folder's file and expected draft, read here rather than through the seed. */
function gold(folder: string) {
  const directory = new URL(
    `../../../../eval/gold/${folder}/`,
    import.meta.url,
  );
  const source = readdirSync(directory).find((f) => f.startsWith("source."))!;
  const bytes = new Uint8Array(readFileSync(new URL(source, directory)));
  return {
    bytes,
    sha256: hash(bytes),
    expected: ExtractedDocument.parse(
      JSON.parse(readFileSync(new URL("expected.json", directory), "utf8")),
    ),
  };
}

const supplierId = async (taxId: string) =>
  (
    await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.taxId, taxId))
  )[0]?.id ?? null;

const demoRows = () =>
  db.select().from(documents).where(inArray(documents.id, ids));

const counts = async () =>
  Object.fromEntries(
    await Promise.all(
      Object.entries({
        documents,
        documentFiles,
        suppliers,
        products,
        unitConversions,
        supplierProducts,
      }).map(async ([name, table]) => {
        const [row] = await db.select({ n: count() }).from(table);
        return [name, row!.n] as const;
      }),
    ),
  );

beforeEach(async () => {
  lines.length = 0;
  await db.execute(
    sql`truncate ${users}, ${documents}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
  );
});

describe("the demo documents (#119)", () => {
  it("are seeded ready for review, each file stored and each draft its expected.json, checked", async () => {
    const storage = createMemoryStorage();
    await seed(storage);

    const rows = await demoRows();
    expect(rows).toHaveLength(4);
    const [office] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEMO_UPLOADER));
    for (const { id, gold: folder } of DEMO_DOCUMENTS) {
      const row = rows.find((r) => r.id === id)!;
      const { bytes, sha256, expected } = gold(folder);
      expect(row).toMatchObject({
        status: "ready_for_review",
        type: expected.documentType,
        number: expected.number,
        date: expected.issueDate,
        draft: expected,
        corrected: null,
        uploadedBy: office!.id,
      });
      // The checks a real read would have stored.
      expect(row.checkFailures).toEqual(
        (await checked(db, id, expected, NOW)).checkFailures,
      );

      const files = await db
        .select()
        .from(documentFiles)
        .where(eq(documentFiles.documentId, id));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        position: 1,
        sha256,
        sizeBytes: bytes.length,
      });
      // By its hash: comparing megabytes byte by byte takes seconds.
      expect(hash(await storage.get(files[0]!.storageKey))).toBe(sha256);
    }
  });

  it("three are delivery notes, and the fourth the invoice for the first (#120)", async () => {
    await seed(createMemoryStorage());
    const typeOf = new Map((await demoRows()).map((r) => [r.id, r.type]));
    expect(DEMO_DOCUMENTS.map((d) => typeOf.get(d.id))).toEqual([
      "delivery-note",
      "delivery-note",
      "delivery-note",
      "invoice",
    ]);
    const note = gold(DEMO_DOCUMENTS[0]!.gold).expected;
    const invoice = gold(DEMO_DOCUMENTS[3]!.gold).expected;
    expect(invoice.supplier.taxId).toBe(note.supplier.taxId);
    expect(invoice.deliveryNotes).toEqual([note.number]);
  });

  it("two are from suppliers we know; Huerta La Ejemplar is left to create in review", async () => {
    await seed(createMemoryStorage());
    const supplierOf = new Map(
      (await demoRows()).map((r) => [r.id, r.supplierId]),
    );
    expect(supplierOf.get(DEMO_DOCUMENTS[0]!.id)).toBe(
      await supplierId("B00777029"),
    );
    expect(supplierOf.get(DEMO_DOCUMENTS[1]!.id)).toBeNull();
    expect(await supplierId("B00123455")).toBeNull();
    expect(supplierOf.get(DEMO_DOCUMENTS[2]!.id)).toBe(
      await supplierId("B00555664"),
    );
    expect(supplierOf.get(DEMO_DOCUMENTS[3]!.id)).toBe(
      await supplierId("B00777029"),
    );
  });

  it("in review, the lines the demo mapped are matched by their code, and the rest are left to map", async () => {
    await seed(createMemoryStorage());
    const matched = async (id: string) =>
      (await readMatching(db, id))!.lines
        .filter((l) => l.match !== null)
        .map((l) => ({ line: l.line, by: l.match!.by }));
    expect(await matched(DEMO_DOCUMENTS[0]!.id)).toEqual([
      { line: 1, by: "code" },
      { line: 3, by: "code" },
    ]);
    expect(await matched(DEMO_DOCUMENTS[1]!.id)).toEqual([]);
    expect(await matched(DEMO_DOCUMENTS[2]!.id)).toEqual([
      { line: 1, by: "code" },
      { line: 15, by: "code" },
    ]);
  });

  it("each mapped line's pack is in one of its product's units", async () => {
    await seed(null);
    const rows = await db
      .select({
        code: supplierProducts.code,
        packUnit: supplierProducts.packUnit,
        productId: supplierProducts.productId,
        baseUnit: products.baseUnit,
      })
      .from(supplierProducts)
      .innerJoin(products, eq(products.id, supplierProducts.productId))
      .where(
        inArray(
          supplierProducts.code,
          demoSupplierProducts.map((s) => s.code),
        ),
      );
    expect(rows).toHaveLength(demoSupplierProducts.length);
    for (const row of rows) {
      const units = (
        await db
          .select({ unit: unitConversions.unit })
          .from(unitConversions)
          .where(eq(unitConversions.productId, row.productId))
      ).map((c) => c.unit);
      expect([row.baseUnit, ...units]).toContain(row.packUnit);
    }
  });

  it("a second run changes nothing, and knows the documents by their IDs", async () => {
    const storage = createMemoryStorage();
    await seed(storage);
    const first = await counts();
    const keys = storage.keys();
    lines.length = 0;
    await seed(storage);
    expect(await counts()).toEqual(first);
    expect(storage.keys()).toEqual(keys);
    // Not as files uploaded already: they're the demo's own.
    expect(lines).toContain(
      "Inserted 0 demo documents ready for review; 4 were there already.",
    );
  });

  it("on a database with a catalogue already, as on staging, the demo's rows are added and the rest left as they were", async () => {
    await db
      .insert(storerooms)
      .values({ name: "Cámara frigorífica", type: "cold_room" });
    await db.insert(suppliers).values({
      name: "Carnes de antes, S.L.",
      taxId: "B00777029",
    });
    // A product named like one of the demo's, though not written the same way.
    await db
      .insert(products)
      .values({ name: "POLLO ENTERO", baseUnit: "unit", category: "other" });

    await seed(createMemoryStorage());

    // The catalogue's own tables had rows, so only the demo's rows were added.
    expect(await counts()).toMatchObject({
      suppliers: 2,
      products: demoProducts.length,
      documents: 4,
    });
    const [carnes] = await db
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.taxId, "B00777029"));
    expect(carnes?.name).toBe("Carnes de antes, S.L.");
    const pollo = await db
      .select({ baseUnit: products.baseUnit, category: products.category })
      .from(products)
      .where(sql`lower(${products.name}) = 'pollo entero'`);
    expect(pollo).toEqual([{ baseUnit: "unit", category: "other" }]);
    // Supplier products whose products were there already, or are the demo's, are added.
    expect(
      await db
        .select({ code: supplierProducts.code })
        .from(supplierProducts)
        .orderBy(supplierProducts.code),
    ).toEqual(
      demoSupplierProducts
        .filter((s) => demoProducts.some((p) => p.name === s.product))
        .map((s) => ({ code: s.code }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    );
  });

  it("a gold file uploaded already skips its document only, and the rest are seeded", async () => {
    const office = await createUser(auth, {
      email: DEMO_UPLOADER,
      name: "Office",
      role: "office",
      password: TEST_PASSWORD,
    });
    const { bytes, sha256 } = gold(DEMO_DOCUMENTS[0]!.gold);
    const [uploaded] = await db
      .insert(documents)
      .values({ uploadedBy: office.id })
      .returning({ id: documents.id });
    await db.insert(documentFiles).values({
      documentId: uploaded!.id,
      position: 1,
      kind: "image",
      contentType: "image/jpeg",
      sizeBytes: bytes.length,
      sha256,
      storageKey: `documents/${uploaded!.id}/1.jpg`,
    });

    await seed(createMemoryStorage());
    expect((await demoRows()).map((r) => r.id).sort()).toEqual(
      ids.slice(1).sort(),
    );
    expect(lines).toContain(
      `Skipped demo document ${DEMO_DOCUMENTS[0]!.gold}: its file was uploaded already.`,
    );
  });

  it("without storage, the documents are skipped and the catalogue is still seeded", async () => {
    await seed(null);
    expect(await demoRows()).toEqual([]);
    expect(await counts()).toMatchObject({
      documents: 0,
      products: seedProducts.length + demoProducts.length,
    });
    expect(lines).toContain(
      "Skipped the demo documents: no storage for their files (S3_*).",
    );
  });

  it("without the office login, the documents are skipped", async () => {
    await createUser(auth, {
      email: "someone@example.test",
      name: "Someone",
      role: "owner",
      password: TEST_PASSWORD,
    });
    await seed(createMemoryStorage());
    expect(await demoRows()).toEqual([]);
    expect(lines).toContain(
      `Skipped the demo documents: no user ${DEMO_UPLOADER} to have uploaded them.`,
    );
  });

  it("a file that can't be stored leaves no row behind", async () => {
    const failing: Storage = {
      ...createMemoryStorage(),
      put: async () => {
        throw new Error("storage is down");
      },
    };
    await expect(seed(failing)).rejects.toThrow("storage is down");
    expect(await demoRows()).toEqual([]);
  });
});

describe("the demo invoice (#120)", () => {
  const app = buildApp(config, { storage: createMemoryStorage() });
  afterAll(() => app.close());

  const productId = async (name: string) =>
    (
      await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.name, name))
    )[0]!.id;

  it("bills the demo's Carnes Ficticias delivery note: until it's posted, its lines are received with the invoice; then each is suggested its delivery-note line, two at new prices, and posting it moves their average costs", async () => {
    // Signed in first: the seed keeps a login that's there, and uploads the demo as it.
    const office = apiAs(app, await signedInAs(app, auth, "office"));
    await seed(createMemoryStorage());
    const [note, , , invoice] = ids as [string, string, string, string];
    const matching = () =>
      office.read(`/api/documents/${invoice}/matching`, DocumentMatching);

    // Carnes Ficticias has posted no delivery note yet: so far, an invoice-only supplier's.
    expect((await matching()).lines.map((l) => l.billing?.by)).toEqual(
      Array(5).fill("received"),
    );

    // The delivery note reviewed, its three lines the demo left to map mapped, and posted.
    for (const [line, product, unit] of [
      [2, "Pollo entero", "kg"],
      [4, "Chorizo para cocinar", "unit"],
      [5, "Panceta curada", "kg"],
    ] as const) {
      const mapped = await office.send(
        "POST",
        `/api/documents/${note}/lines/${line}/mapping`,
        {
          productId: await productId(product),
          pack: { quantity: "1", unit },
        },
      );
      expect(mapped.statusCode, mapped.body).toBe(201);
    }
    const storerooms = Array(5).fill(null);
    const postedNote = await office.send(
      "POST",
      `/api/documents/${note}/post`,
      { storerooms },
    );
    expect(postedNote.statusCode, postedNote.body).toBe(200);

    // Each invoice line suggested its line of the delivery note it lists.
    const suggested = await matching();
    expect(suggested.lines.map((l) => l.billing?.by)).toEqual(
      Array(5).fill("suggested"),
    );
    expect(
      suggested.lines.map((l) =>
        l.billing && l.billing.by !== "received" ? l.billing.difference : null,
      ),
    ).toEqual(["1.17", "0.00", "0.00", "0.00", "-0.54"]);
    expect(suggested.difference).toBe("0.63");
    expect(suggested.reviewReasons).toEqual(["new_supplier", "unbilled_lines"]);

    // Confirmed as suggested, and posted: the solomillo and the panceta now cost the invoice's.
    const confirmed = await office.send(
      "PUT",
      `/api/documents/${invoice}/billing`,
      {
        lines: suggested.lines.map((l) => ({
          deliveryNoteLineId:
            l.billing?.by === "suggested" ? l.billing.deliveryNoteLine.id : "",
        })),
      },
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const postedInvoice = await office.send(
      "POST",
      `/api/documents/${invoice}/post`,
      { storerooms },
    );
    expect(postedInvoice.statusCode, postedInvoice.body).toBe(200);
    const cost = async (name: string) =>
      (
        await office.read(
          `/api/products/${await productId(name)}/stock`,
          ProductStock,
        )
      ).storerooms.map((s) => [s.onHand, s.averageCost]);
    expect(await cost("Solomillo de ternera")).toEqual([[2350, "0.033400"]]);
    // The invoice's line total over its base units (decision 0041): €11.77 for 1080 g, not the
    // €10.90 a kilo printed, which the line total rounds.
    expect(await cost("Panceta curada")).toEqual([[1080, "0.010898"]]);
    // At the same price, as the delivery note put it in: €20.01 for 4125 g.
    expect(await cost("Pollo entero")).toEqual([[4125, "0.004851"]]);
  });
});

it("the demo's catalogue is new to the seed's: no supplier or product twice", () => {
  const taxIds = new Set(seedSuppliers.map((s) => s.taxId));
  expect(demoSuppliers.filter((s) => taxIds.has(s.taxId))).toEqual([]);
  const names = new Set(seedProducts.map((p) => p.name.toLowerCase()));
  expect(demoProducts.filter((p) => names.has(p.name.toLowerCase()))).toEqual(
    [],
  );
});
