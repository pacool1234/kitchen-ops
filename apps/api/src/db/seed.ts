// Synthetic data for local development and CI: products and one user per role.
// Never real supplier, client or staff data.
import type { Role } from "@kitchen-ops/shared";
import { count } from "drizzle-orm";
import { createAuth } from "../auth/auth";
import { createUser } from "../auth/users";
import { ConfigError, loadSeedConfig } from "../config";
import { createDb } from "./client";
import { products, users } from "./schema";

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

// Local-only logins, documented in the README. Obviously fake: never reuse them anywhere real.
// The owner starts without 2FA; the first sign-in has to set it up.
const seedUsers: { role: Role; password: string }[] = [
  { role: "counter", password: "local-only-counter" }, // gitleaks:allow
  { role: "office", password: "local-only-office" }, // gitleaks:allow
  { role: "owner", password: "local-only-owner" }, // gitleaks:allow
];

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed: NODE_ENV is production.");
  process.exit(1);
}

try {
  const config = loadSeedConfig(process.env);
  const { db, close } = createDb(config.DATABASE_URL);
  try {
    const [existingProducts] = await db.select({ n: count() }).from(products);
    if (existingProducts && existingProducts.n > 0) {
      console.log(`Skipped products: already ${existingProducts.n} rows.`);
    } else {
      await db.insert(products).values(syntheticProducts);
      console.log(`Inserted ${syntheticProducts.length} synthetic products.`);
    }

    const [existingUsers] = await db.select({ n: count() }).from(users);
    if (existingUsers && existingUsers.n > 0) {
      console.log(`Skipped users: already ${existingUsers.n} rows.`);
    } else {
      const auth = createAuth(db, config);
      for (const { role, password } of seedUsers) {
        await createUser(auth, {
          email: `${role}@example.test`,
          name: `Local ${role}`,
          role,
          password,
        });
      }
      console.log(
        `Created ${seedUsers.length} users: ${seedUsers.map((u) => `${u.role}@example.test`).join(", ")}.`,
      );
    }
  } finally {
    await close();
  }
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
