// Inserts synthetic products for local development and CI. Never real supplier or client data.
import { count } from "drizzle-orm";
import { ConfigError, loadDatabaseUrl } from "../config";
import { createDb } from "./client";
import { products } from "./schema";

const syntheticProducts: (typeof products.$inferInsert)[] = [
  { name: "Tomato", baseUnit: "g" },
  { name: "Onion", baseUnit: "g" },
  { name: "Flour", baseUnit: "g" },
  { name: "Olive oil", baseUnit: "ml" },
  { name: "Whole milk", baseUnit: "ml" },
  { name: "Eggs", baseUnit: "unit" },
  { name: "Lemons", baseUnit: "unit" },
  { name: "Saffron (discontinued)", baseUnit: "g", active: false },
];

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed: NODE_ENV is production.");
  process.exit(1);
}

try {
  const { db, close } = createDb(loadDatabaseUrl(process.env));
  try {
    const [existing] = await db.select({ n: count() }).from(products);
    if (existing && existing.n > 0) {
      console.log(`Skipped: products already has ${existing.n} rows.`);
    } else {
      await db.insert(products).values(syntheticProducts);
      console.log(`Inserted ${syntheticProducts.length} synthetic products.`);
    }
  } finally {
    await close();
  }
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
