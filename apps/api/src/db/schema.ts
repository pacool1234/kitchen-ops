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

/** The unit a product's stock is counted in (spec section 3). */
export const baseUnit = pgEnum("base_unit", ["g", "ml", "unit"]);

export const products = pgTable("products", {
  // UUID v7 from Postgres 18: safe to show in URLs, and time-ordered so new rows go to the end
  // of the index.
  id: uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`),
  name: text("name").notNull(),
  baseUnit: baseUnit("base_unit").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
