import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { ExtractedDocument } from "@kitchen-ops/shared";
import { eq, sql } from "drizzle-orm";
import { checkUpload } from "../documents/upload";
import { checked } from "../extraction/read";
import type { Storage } from "../storage/storage";
import type { Db } from "./client";
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
import type { SeedProduct, SeedSupplierProduct } from "./seed-catalogue";

// The demo's documents (#119, decision 0039): three synthetic documents from the gold set, ready
// for review as if they had just been read, to try reviewing and posting with. Their drafts are
// the gold set's hand-checked expected.json, so no model is called; they're checked as a read
// document is. Staging's tables have rows already, so each row is added only if it isn't there:
// a supplier by its tax ID, a product by its name, a supplier product by its supplier and code,
// a document by its fixed ID. A row that's there is never changed. Not audited, like the rest
// of the seed.

/** `eval/gold/` at the repository root, in Render's checkout too. */
const GOLD = new URL("../../../../eval/gold/", import.meta.url);

/** A demo document: its fixed ID, and the gold folder it comes from. */
export interface DemoDocument {
  id: string;
  gold: string;
}

export const DEMO_DOCUMENTS: DemoDocument[] = [
  // A photo of a priced delivery note, from a supplier we know.
  {
    id: "01a15b87-1c42-71f6-b671-4b48b8cbac4a",
    gold: "syn-017-picture-from-004",
  },
  // A photo of one without prices, from a supplier to create in review.
  {
    id: "01a15b87-1c43-73dc-bfc4-076f5011f308",
    gold: "syn-014-picture-from-001",
  },
  // A long PDF without prices; one line is printed with nothing delivered.
  {
    id: "01a15b87-1c43-7f1e-9407-c8454029e3a9",
    gold: "syn-012-delivery-note-no-prices",
  },
];

/** Who the demo documents were uploaded by: a login both seeds create. */
export const DEMO_UPLOADER = "office@example.test";

/** Two of the documents' suppliers. The third, Huerta La Ejemplar, is left to create in review. */
export const demoSuppliers: (typeof suppliers.$inferInsert)[] = [
  {
    name: "Carnes Ficticias de Ejemplo, S.L.",
    taxId: "B00777029",
    email: "pedidos@carnesficticias.example",
  },
  {
    name: "Suministros Hosteleros Inventados, S.L.",
    taxId: "B00555664",
  },
];

/** The products the documents' lines need that the catalogue doesn't have. */
export const demoProducts: SeedProduct[] = [
  {
    name: "Pollo entero",
    baseUnit: "g",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Hamburguesa de ternera 180 g",
    baseUnit: "unit",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "caja", factor: 20000 }],
  },
  {
    name: "Chorizo para cocinar",
    baseUnit: "unit",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [],
  },
  {
    name: "Panceta curada",
    baseUnit: "g",
    category: "meat",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Queso rallado",
    baseUnit: "g",
    category: "dairy",
    storeroom: "Cámara frigorífica",
    conversions: [{ unit: "kg", factor: 1000 }],
  },
  {
    name: "Aceite de girasol",
    baseUnit: "ml",
    category: "dry_goods",
    storeroom: "Almacén seco",
    conversions: [{ unit: "bidón", factor: 25000 }],
  },
  {
    name: "Lejía",
    baseUnit: "ml",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "garrafa", factor: 5000 }],
  },
  {
    name: "Desengrasante",
    baseUnit: "ml",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "garrafa", factor: 5000 }],
  },
  {
    name: "Abrillantador",
    baseUnit: "ml",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "garrafa", factor: 5000 }],
  },
  {
    name: "Gel hidroalcohólico",
    baseUnit: "ml",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "botella", factor: 1000 }],
  },
  {
    name: "Papel secamanos",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "caja", factor: 20000 }],
  },
  {
    name: "Bobina de papel industrial",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [],
  },
  {
    name: "Bolsas de basura",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [],
  },
  {
    name: "Guantes de nitrilo",
    baseUnit: "unit",
    category: "cleaning",
    storeroom: "Almacén seco",
    conversions: [{ unit: "caja", factor: 100000 }],
  },
  {
    name: "Film transparente (rollo)",
    baseUnit: "unit",
    category: "other",
    storeroom: "Almacén seco",
    conversions: [],
  },
  {
    name: "Papel de aluminio (rollo)",
    baseUnit: "unit",
    category: "other",
    storeroom: "Almacén seco",
    conversions: [],
  },
];

/** Some lines already mapped, so review shows matched lines next to ones still to map. */
export const demoSupplierProducts: SeedSupplierProduct[] = [
  {
    supplierTaxId: "B00777029",
    code: "CF-101",
    description: "Solomillo de ternera",
    product: "Solomillo de ternera",
    pack: { quantity: "1", unit: "kg" },
  },
  {
    supplierTaxId: "B00777029",
    code: "CF-310",
    description: "Hamburguesa 180 g (caja 20 ud)",
    product: "Hamburguesa de ternera 180 g",
    pack: { quantity: "1", unit: "caja" },
  },
  {
    supplierTaxId: "B00555664",
    code: "SH-1102",
    description: "LEJIA CONCENTRADA 5 L",
    product: "Lejía",
    pack: { quantity: "1", unit: "garrafa" },
  },
  {
    supplierTaxId: "B00555664",
    code: "AL-2093",
    description: "NATA COCINA 18% 1 L",
    product: "Nata para cocinar",
    pack: { quantity: "1", unit: "brik" },
  },
];

/** Adds the demo's suppliers, products and supplier products that aren't there. */
async function seedDemoCatalogue(db: Db, log: (line: string) => void) {
  await db.transaction(async (tx) => {
    const addedSuppliers = await tx
      .insert(suppliers)
      .values(demoSuppliers)
      .onConflictDoNothing()
      .returning({ id: suppliers.id });

    const storeroomIds = new Map(
      (await tx.select().from(storerooms)).map((s) => [s.name, s.id]),
    );
    let addedProducts = 0;
    for (const { storeroom, conversions, ...product } of demoProducts) {
      const [row] = await tx
        .insert(products)
        .values({ ...product, defaultStoreroomId: storeroomIds.get(storeroom) })
        .onConflictDoNothing()
        .returning({ id: products.id });
      // One of the same name was there: it's kept as it is, conversions and all.
      if (!row) continue;
      addedProducts += 1;
      if (conversions.length > 0) {
        await tx
          .insert(unitConversions)
          .values(conversions.map((c) => ({ productId: row.id, ...c })));
      }
    }

    let addedOffers = 0;
    for (const {
      supplierTaxId,
      product,
      pack,
      ...offer
    } of demoSupplierProducts) {
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.taxId, supplierTaxId));
      const [ours] = await tx
        .select({ id: products.id })
        .from(products)
        .where(sql`lower(${products.name}) = lower(${product})`);
      if (!supplier || !ours) {
        log(
          `Skipped demo supplier product ${offer.code}: its supplier or product isn't there.`,
        );
        continue;
      }
      const added = await tx
        .insert(supplierProducts)
        .values({
          ...offer,
          supplierId: supplier.id,
          productId: ours.id,
          packQuantity: pack.quantity,
          packUnit: pack.unit,
        })
        .onConflictDoNothing()
        .returning({ id: supplierProducts.id });
      addedOffers += added.length;
    }
    log(
      `Inserted the demo documents' catalogue where missing: ${addedSuppliers.length} suppliers, ${addedProducts} products and ${addedOffers} supplier products.`,
    );
  });
}

/** A gold folder's one file, and its expected draft, validated. */
function readGold(folder: string) {
  const directory = new URL(`${folder}/`, GOLD);
  const source = readdirSync(directory).find((f) => f.startsWith("source."));
  if (!source) throw new Error(`Demo document ${folder}: no source file.`);
  return {
    bytes: new Uint8Array(readFileSync(new URL(source, directory))),
    draft: ExtractedDocument.parse(
      JSON.parse(readFileSync(new URL("expected.json", directory), "utf8")),
    ),
  };
}

/**
 * Adds the demo's suppliers, products and supplier products that aren't there, then its
 * documents that aren't, if there's storage for their files. Each document's file is stored
 * before its rows are written, so no row points at a file that isn't there.
 */
export async function seedDemoDocuments(
  db: Db,
  storage: Storage | null,
  log: (line: string) => void,
  now: Date = new Date(),
): Promise<void> {
  await seedDemoCatalogue(db, log);

  if (!storage) {
    log("Skipped the demo documents: no storage for their files (S3_*).");
    return;
  }
  const [uploader] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_UPLOADER));
  if (!uploader) {
    log(
      `Skipped the demo documents: no user ${DEMO_UPLOADER} to have uploaded them.`,
    );
    return;
  }

  let inserted = 0;
  let there = 0;
  for (const demo of DEMO_DOCUMENTS) {
    const [existing] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, demo.id));
    if (existing) {
      there += 1;
      continue;
    }
    const { bytes, draft } = readGold(demo.gold);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // Uploaded by hand already: a second copy would be refused, as an upload would be.
    const [taken] = await db
      .select({ id: documentFiles.id })
      .from(documentFiles)
      .where(eq(documentFiles.sha256, sha256));
    if (taken) {
      log(`Skipped demo document ${demo.gold}: its file was uploaded already.`);
      continue;
    }
    const upload = checkUpload([{ bytes }]);
    if (!upload.ok) {
      throw new Error(`Demo document ${demo.gold}: its file isn't accepted.`);
    }
    const file = upload.files[0]!;
    const storageKey = `documents/${demo.id}/1.${file.extension}`;
    await storage.put(storageKey, bytes, file.contentType);
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id: demo.id,
        uploadedBy: uploader.id,
        ...(await checked(tx, demo.id, draft, now)),
      });
      await tx.insert(documentFiles).values({
        documentId: demo.id,
        position: 1,
        kind: file.kind,
        contentType: file.contentType,
        sizeBytes: bytes.length,
        sha256,
        storageKey,
      });
    });
    inserted += 1;
  }
  log(
    `Inserted ${inserted} demo documents ready for review; ${there} were there already.`,
  );
}
