// Synthetic data for local development and CI: the fictional restaurant's catalogue (storerooms,
// suppliers, products with their conversions, supplier products), one user per role, and a
// second counter.
// Never real supplier, client or staff data.
import type { Role } from "@kitchen-ops/shared";
import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { createAuth } from "../auth/auth";
import { createUser } from "../auth/users";
import { ConfigError, loadSeedConfig } from "../config";
import { createDb } from "./client";
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

// Local-only logins, documented in the README. Obviously fake: never reuse them anywhere real.
// The owner starts without 2FA; the first sign-in has to set it up.
const seedUsers: { name: string; role: Role; password: string }[] = [
  { name: "counter", role: "counter", password: "local-only-counter" }, // gitleaks:allow
  { name: "office", role: "office", password: "local-only-office" }, // gitleaks:allow
  { name: "owner", role: "owner", password: "local-only-owner" }, // gitleaks:allow
  // A second counter, for trying what changes a user's own settings without changing the
  // others': the browser tests switch its language.
  { name: "staff", role: "counter", password: "local-only-staff" }, // gitleaks:allow
];

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed: NODE_ENV is production.");
  process.exit(1);
}

try {
  const config = loadSeedConfig(process.env);
  const { db, close } = createDb(config.DATABASE_URL);
  try {
    // Each table only if it's empty, so running the seed again changes nothing.
    const seedTable = async (name: string, table: PgTable, rows: object[]) => {
      const [existing] = await db.select({ n: count() }).from(table);
      if (existing && existing.n > 0) {
        console.log(`Skipped ${name}: already ${existing.n} rows.`);
      } else {
        await db.insert(table).values(rows);
        console.log(`Inserted ${rows.length} synthetic ${name}.`);
      }
    };
    await seedTable("storerooms", storerooms, seedStorerooms);
    await seedTable("suppliers", suppliers, seedSuppliers);

    // Products, their conversions and supplier products together: they refer to each other, and
    // to the storerooms and suppliers by name and tax ID.
    const [existingProducts] = await db.select({ n: count() }).from(products);
    if (existingProducts && existingProducts.n > 0) {
      console.log(`Skipped products: already ${existingProducts.n} rows.`);
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
      console.log(
        `Inserted ${seedProducts.length} synthetic products and ${seedSupplierProducts.length} supplier products.`,
      );
    }

    const [existingUsers] = await db.select({ n: count() }).from(users);
    if (existingUsers && existingUsers.n > 0) {
      console.log(`Skipped users: already ${existingUsers.n} rows.`);
    } else {
      const auth = createAuth(db, config);
      for (const { name, role, password } of seedUsers) {
        await createUser(auth, {
          email: `${name}@example.test`,
          name: `Local ${name}`,
          role,
          password,
        });
      }
      console.log(
        `Created ${seedUsers.length} users: ${seedUsers.map((u) => `${u.name}@example.test`).join(", ")}.`,
      );
    }
  } finally {
    await close();
  }
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
