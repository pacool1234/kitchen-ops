import { randomUUIDv7 } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Change this file, then run `pnpm --filter @kitchen-ops/api db:generate` to write the migration.

/**
 * Primary key for every table (decision 0011): a UUID v7, safe to show in URLs and time-ordered
 * so new rows go to the end of the index.
 * - The API creates it (`$defaultFn`, Node's crypto.randomUUIDv7) before inserting, so the ledger
 *   can link records by ID and a retried request can reuse the same ID.
 * - The database default `uuidv7()` (Postgres 18) only covers rows inserted by hand in SQL.
 */
function primaryId() {
  return uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`)
    .$defaultFn(() => randomUUIDv7());
}

/** The unit a product's stock is counted in (spec section 3). */
export const baseUnit = pgEnum("base_unit", ["g", "ml", "unit"]);

export const products = pgTable("products", {
  id: primaryId(),
  name: text("name").notNull(),
  baseUnit: baseUnit("base_unit").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
