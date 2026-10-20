import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Auth } from "../auth/auth";
import { createUser } from "../auth/users";
import type { Storage } from "../storage/storage";
import type { Db } from "./client";
import {
  products,
  storerooms,
  supplierProducts,
  suppliers,
  unitConversions,
  users,
} from "./schema";
import {
  seedProducts,
  seedStorerooms,
  seedSupplierProducts,
  seedSuppliers,
} from "./seed-catalogue";
import { seedDemoDocuments } from "./seed-documents";
import type { SeedPlan } from "./seed-plan";

// Fills a database with the fictional restaurant (#88) and the plan's logins (#100). Each table
// only if it's empty, so running it again changes nothing and keeps whatever was created since:
// staging runs it on every start. Then the demo documents (#119), with what they need of the
// catalogue, each row only if it isn't there: staging's tables have rows already.

/**
 * Seeds what's empty, then the demo documents that are missing, their files kept in `storage`.
 * Says what it did or skipped with `log`.
 */
export async function runSeed(
  db: Db,
  auth: Auth,
  plan: SeedPlan,
  storage: Storage | null,
  log: (line: string) => void = console.log,
  now: Date = new Date(),
): Promise<void> {
  // Each table only if it's empty, so running the seed again changes nothing.
  const seedTable = async (name: string, table: PgTable, rows: object[]) => {
    const [existing] = await db.select({ n: count() }).from(table);
    if (existing && existing.n > 0) {
      log(`Skipped ${name}: already ${existing.n} rows.`);
    } else {
      await db.insert(table).values(rows);
      log(`Inserted ${rows.length} synthetic ${name}.`);
    }
  };
  await seedTable("storerooms", storerooms, seedStorerooms);
  await seedTable("suppliers", suppliers, seedSuppliers);

  // Products, their conversions and supplier products together: they refer to each other, and
  // to the storerooms and suppliers by name and tax ID.
  const [existingProducts] = await db.select({ n: count() }).from(products);
  if (existingProducts && existingProducts.n > 0) {
    log(`Skipped products: already ${existingProducts.n} rows.`);
  } else {
    await db.transaction(async (tx) => {
      const storeroomIds = new Map(
        (await tx.select().from(storerooms)).map((s) => [s.name, s.id]),
      );
      const supplierIds = new Map(
        (await tx.select().from(suppliers)).map((s) => [s.taxId, s.id]),
      );
      const productIds = new Map<string, string>();
      for (const { storeroom, conversions, ...product } of seedProducts) {
        const [row] = await tx
          .insert(products)
          .values({
            ...product,
            defaultStoreroomId: storeroomIds.get(storeroom),
          })
          .returning({ id: products.id });
        productIds.set(product.name, row!.id);
        if (conversions.length > 0) {
          await tx
            .insert(unitConversions)
            .values(conversions.map((c) => ({ productId: row!.id, ...c })));
        }
      }
      await tx.insert(supplierProducts).values(
        seedSupplierProducts.map(
          ({ supplierTaxId, product, pack, ...offer }) => {
            const supplierId = supplierIds.get(supplierTaxId);
            if (!supplierId) {
              throw new Error(
                `No supplier with tax ID ${supplierTaxId}: reset the database (db:reset) and seed again.`,
              );
            }
            return {
              ...offer,
              supplierId,
              productId: productIds.get(product)!,
              packQuantity: pack.quantity,
              packUnit: pack.unit,
            };
          },
        ),
      );
    });
    log(
      `Inserted ${seedProducts.length} synthetic products and ${seedSupplierProducts.length} supplier products.`,
    );
  }

  const [existingUsers] = await db.select({ n: count() }).from(users);
  if (existingUsers && existingUsers.n > 0) {
    log(`Skipped users: already ${existingUsers.n} rows.`);
  } else {
    for (const user of plan.users) await createUser(auth, user);
    log(
      `Created ${plan.users.length} ${plan.mode} users: ${plan.users.map((u) => u.email).join(", ")}.`,
    );
  }

  await seedDemoDocuments(db, storage, log, now);
}
