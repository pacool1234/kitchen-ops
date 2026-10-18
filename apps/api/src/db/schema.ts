import { AUDIT_ACTIONS, BASE_UNITS } from "@kitchen-ops/shared";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { AuditChanges } from "../audit/diff";
import { users } from "./auth-schema";
import { createdAt, primaryId } from "./columns";

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
