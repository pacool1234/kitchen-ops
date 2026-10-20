import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { ExtractedDocument } from "@kitchen-ops/shared";
import { count, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "../auth/auth";
import { createUser } from "../auth/users";
import { checked } from "../extraction/read";
import { readMatching } from "../matching/matching";
import { createMemoryStorage } from "../storage/memory";
import type { Storage } from "../storage/storage";
import { TEST_PASSWORD } from "../test/auth";
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
    expect(rows).toHaveLength(3);
    const [office] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEMO_UPLOADER));
    for (const { id, gold: folder } of DEMO_DOCUMENTS) {
      const row = rows.find((r) => r.id === id)!;
      const { bytes, sha256, expected } = gold(folder);
      expect(row).toMatchObject({
        status: "ready_for_review",
        type: "delivery-note",
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

  it("a second run changes nothing", async () => {
    const storage = createMemoryStorage();
    await seed(storage);
    const first = await counts();
    const keys = storage.keys();
    await seed(storage);
    expect(await counts()).toEqual(first);
    expect(storage.keys()).toEqual(keys);
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
      documents: 3,
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
      [DEMO_DOCUMENTS[1]!.id, DEMO_DOCUMENTS[2]!.id].sort(),
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

it("the demo's catalogue is new to the seed's: no supplier or product twice", () => {
  const taxIds = new Set(seedSuppliers.map((s) => s.taxId));
  expect(demoSuppliers.filter((s) => taxIds.has(s.taxId))).toEqual([]);
  const names = new Set(seedProducts.map((p) => p.name.toLowerCase()));
  expect(demoProducts.filter((p) => names.has(p.name.toLowerCase()))).toEqual(
    [],
  );
});
