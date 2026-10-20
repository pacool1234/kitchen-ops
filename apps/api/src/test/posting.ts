import { parseUnitCost } from "@kitchen-ops/ledger";
import { sql } from "drizzle-orm";
import type { Auth } from "../auth/auth";
import { createUser } from "../auth/users";
import type { Db } from "../db/client";
import {
  documents,
  products,
  storerooms,
  suppliers,
  unitConversions,
  users,
} from "../db/schema";
import type { ReviewedDocument, ReviewedLine } from "../posting/posting";
import { TEST_PASSWORD } from "./auth";
import { syntheticCif } from "./catalogue";

// Posting in tests (#116): a user, two storerooms, a supplier, and two products with their
// purchase units, set up straight in the database; then documents ready for review.

export interface PostingCatalogue {
  readonly userId: string;
  readonly coldRoom: string;
  readonly dryStore: string;
  readonly supplier: string;
  /** Counted in grams; bought by the kg or by the 6 kg box. */
  readonly tomatoes: string;
  /** Counted in units (thousandths); bought by the dozen. */
  readonly eggs: string;
}

/** Empties every table, then sets the catalogue up. */
export async function setUpCatalogue(
  db: Db,
  auth: Auth,
): Promise<PostingCatalogue> {
  await db.execute(
    sql`truncate ${users}, ${documents}, ${products}, ${storerooms}, ${suppliers}, verifications cascade`,
  );
  const user = await createUser(auth, {
    email: "office@example.test",
    name: "Test office",
    role: "office",
    password: TEST_PASSWORD,
  });
  const [cold, dry] = await db
    .insert(storerooms)
    .values([
      { name: "Cámara", type: "cold_room" },
      { name: "Almacén", type: "dry_store" },
    ])
    .returning({ id: storerooms.id });
  const [supplier] = await db
    .insert(suppliers)
    .values({ name: "Proveedor de prueba", taxId: syntheticCif(1) })
    .returning({ id: suppliers.id });
  const [tomatoes, eggs] = await db
    .insert(products)
    .values([
      { name: "Tomate", baseUnit: "g", category: "produce" },
      { name: "Huevos", baseUnit: "unit", category: "dairy" },
    ])
    .returning({ id: products.id });
  await db.insert(unitConversions).values([
    { productId: tomatoes!.id, unit: "kg", factor: 1000 },
    { productId: tomatoes!.id, unit: "box", factor: 6000 },
    { productId: eggs!.id, unit: "dozen", factor: 12_000 },
  ]);
  return {
    userId: user.id,
    coldRoom: cold!.id,
    dryStore: dry!.id,
    supplier: supplier!.id,
    tomatoes: tomatoes!.id,
    eggs: eggs!.id,
  };
}

/** A document as extraction leaves it: ready for review, with no type or supplier yet. */
export async function documentToReview(
  db: Db,
  catalogue: PostingCatalogue,
  status: "ready_for_review" | "queued" = "ready_for_review",
): Promise<string> {
  const [row] = await db
    .insert(documents)
    .values({ status, uploadedBy: catalogue.userId })
    .returning({ id: documents.id });
  return row!.id;
}

export function reviewedLine(
  productId: string,
  quantity: string,
  unit: string,
  price: string,
  more: Partial<ReviewedLine> = {},
): ReviewedLine {
  return {
    productId,
    quantity,
    unit,
    unitPrice: parseUnitCost(price),
    ...more,
  };
}

export function reviewed(
  catalogue: PostingCatalogue,
  lines: readonly ReviewedLine[],
  more: Partial<ReviewedDocument> = {},
): ReviewedDocument {
  return {
    type: "delivery-note",
    supplierId: catalogue.supplier,
    number: "A-1",
    date: "2026-10-20",
    storeroomId: catalogue.coldRoom,
    lines,
    ...more,
  };
}
