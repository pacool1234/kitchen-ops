import { randomUUIDv7 } from "node:crypto";
import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Primary key for every table (decision 0011): a UUID v7, safe to show in URLs and time-ordered
 * so new rows go to the end of the index.
 * - The API creates it (`$defaultFn`, Node's crypto.randomUUIDv7) before inserting, so the ledger
 *   can link records by ID and a retried request can reuse the same ID.
 * - The database default `uuidv7()` (Postgres 18) only covers rows inserted by hand in SQL.
 */
export function primaryId() {
  return uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`)
    .$defaultFn(() => randomUUIDv7());
}

/** `created_at`, set once by the database. */
export function createdAt() {
  return timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
}

/** `updated_at`, refreshed by Drizzle on every update. */
export function updatedAt() {
  return timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
}
