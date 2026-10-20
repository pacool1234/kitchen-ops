import { randomUUIDv7 } from "node:crypto";
import type { ExtractedDocument } from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

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

/**
 * A draft as stored (`documents.draft` and `corrected`): jsonb, read and written as Drizzle's own
 * jsonb is. A draft saved before drafts listed the delivery notes they bill (#120) has no list,
 * and is read as listing none: drafts of posted documents can't be updated to add one.
 */
export const storedDraft = customType<{
  data: ExtractedDocument;
  driverData: string | ExtractedDocument;
}>({
  dataType: () => "jsonb",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => {
    const draft = (
      typeof value === "string" ? JSON.parse(value) : value
    ) as Partial<ExtractedDocument> & Omit<ExtractedDocument, "deliveryNotes">;
    return { ...draft, deliveryNotes: draft.deliveryNotes ?? [] };
  },
});
