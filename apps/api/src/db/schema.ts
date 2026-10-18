import {
  AUDIT_ACTIONS,
  BASE_UNITS,
  STOREROOM_TYPES,
} from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AuditChanges } from "../audit/diff";
import { users } from "./auth-schema";
import { createdAt, primaryId, updatedAt } from "./columns";

export * from "./auth-schema";

// Change this file, then run `pnpm --filter @kitchen-ops/api db:generate` to write the migration.

/** The unit a product's stock is counted in (spec section 3); values come from packages/shared. */
export const baseUnit = pgEnum("base_unit", BASE_UNITS);

export const products = pgTable("products", {
  id: primaryId(),
  name: text("name").notNull(),
  baseUnit: baseUnit("base_unit").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** A storeroom's kind (spec section 3); values come from packages/shared. */
export const storeroomType = pgEnum("storeroom_type", STOREROOM_TYPES);

/** Where stock is kept (#88). Deactivated rather than deleted: movements will refer to it. */
export const storerooms = pgTable(
  "storerooms",
  {
    id: primaryId(),
    name: text("name").notNull(),
    type: storeroomType("type").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("storerooms_name_unique").on(sql`lower(${table.name})`),
  ],
);

/** Who the restaurant buys from (#88). Deactivated rather than deleted: documents will refer to it. */
export const suppliers = pgTable(
  "suppliers",
  {
    id: primaryId(),
    name: text("name").notNull(),
    /** Normalized (normalizeTaxId in packages/shared), and checked before it's saved. */
    taxId: text("tax_id").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("suppliers_tax_id_unique").on(table.taxId)],
);

/**
 * The request field each unique index guards: a duplicate answers 409 naming it
 * (src/errors.ts).
 */
export const UNIQUE_FIELDS: Readonly<Record<string, string>> = {
  storerooms_name_unique: "name",
  suppliers_tax_id_unique: "taxId",
};

/** What a write did (spec section 6); values come from packages/shared. */
export const auditAction = pgEnum("audit_action", AUDIT_ACTIONS);

/**
 * Every write: who, what, when, from which document and request, and the changed fields
 * (#87, decision 0025). Append-only: a trigger refuses updates and deletes (migration
 * 0004_audit_log_append_only). Written only through `audited()` (src/audit/audited.ts), in the
 * same transaction as the change.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: primaryId(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // No cascade: a user with history can't be deleted, only deactivated.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    action: auditAction("action").notNull(),
    entityType: text("entity_type").notNull(),
    // Text, so an entity without a UUID can be logged too.
    entityId: text("entity_id").notNull(),
    // The supplier document behind the change. No foreign key until documents exist (M6).
    documentId: uuid("document_id"),
    requestId: text("request_id").notNull(),
    changes: jsonb("changes").$type<AuditChanges>().notNull(),
  },
  (table) => [
    index("audit_log_entity_idx").on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index("audit_log_user_idx").on(table.userId, table.occurredAt),
    index("audit_log_occurred_at_idx").on(table.occurredAt),
  ],
);
