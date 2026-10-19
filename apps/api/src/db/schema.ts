import {
  AUDIT_ACTIONS,
  DOCUMENT_STATUSES,
  EXTRACTED_DOCUMENT_TYPES,
  FILE_KINDS,
  BASE_UNITS,
  PRODUCT_CATEGORIES,
  STOREROOM_TYPES,
} from "@kitchen-ops/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
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

/** What a product is (#88); values come from packages/shared. */
export const productCategory = pgEnum("product_category", PRODUCT_CATEGORIES);

/**
 * What is bought, counted and cooked (spec section 3, #88). Deactivated rather than deleted. The
 * base unit is set when it's created and never changes: stock is counted in it.
 */
export const products = pgTable(
  "products",
  {
    id: primaryId(),
    name: text("name").notNull(),
    baseUnit: baseUnit("base_unit").notNull(),
    // The default only fills the rows that existed before categories (migration 0007).
    category: productCategory("category").notNull().default("other"),
    defaultStoreroomId: uuid("default_storeroom_id").references(
      () => storerooms.id,
    ),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("products_name_unique").on(sql`lower(${table.name})`),
    index("products_default_storeroom_idx").on(table.defaultStoreroomId),
  ],
);

/**
 * How many base units one of a product's purchase units holds: a box of tomatoes, 6000 g
 * (spec section 3; packages/ledger's UnitConversion). The base unit's own isn't stored: the API
 * adds it. Replaced with its product's list when that changes.
 */
export const unitConversions = pgTable(
  "unit_conversions",
  {
    id: primaryId(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    unit: text("unit").notNull(),
    factor: integer("factor").notNull(),
  },
  (table) => [
    uniqueIndex("unit_conversions_product_unit_unique").on(
      table.productId,
      sql`lower(${table.unit})`,
    ),
    check("unit_conversions_factor_positive", sql`${table.factor} > 0`),
  ],
);

/**
 * How a supplier names and packs one of our products (spec section 3, #88): its code, unique per
 * supplier, and a pack of a quantity in one of the product's units. Deactivated, not deleted.
 */
export const supplierProducts = pgTable(
  "supplier_products",
  {
    id: primaryId(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    code: text("code").notNull(),
    description: text("description").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    // A decimal with up to 6 places, read and written as text: never a JavaScript number.
    packQuantity: numeric("pack_quantity", {
      precision: 18,
      scale: 6,
    }).notNull(),
    packUnit: text("pack_unit").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("supplier_products_supplier_code_unique").on(
      table.supplierId,
      table.code,
    ),
    index("supplier_products_product_idx").on(table.productId),
    check(
      "supplier_products_pack_quantity_positive",
      sql`${table.packQuantity} > 0`,
    ),
  ],
);

/** Where a document is on its way to review (#102); values come from packages/shared. */
export const documentStatus = pgEnum("document_status", DOCUMENT_STATUSES);
/** A delivery note or an invoice, once read: the extraction's own values. */
export const documentType = pgEnum("document_type", EXTRACTED_DOCUMENT_TYPES);
export const documentFileKind = pgEnum("document_file_kind", FILE_KINDS);

/**
 * A supplier document (spec section 3, #102): one PDF or Facturae file, or one or several photos,
 * on its way to review. Its type, supplier, number and date are filled in once it's read (#104).
 */
export const documents = pgTable(
  "documents",
  {
    id: primaryId(),
    status: documentStatus("status").notNull().default("queued"),
    type: documentType("type"),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    number: text("number"),
    date: date("date", { mode: "string" }),
    // No cascade: a user who uploaded documents can't be deleted, only deactivated.
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("documents_status_created_idx").on(table.status, table.createdAt),
    index("documents_created_idx").on(table.createdAt),
  ],
);

/**
 * One file of a document, in object storage (decision 0029). Its sha256 is unique: a file
 * received once is never received again as another document.
 */
export const documentFiles = pgTable(
  "document_files",
  {
    id: primaryId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    /** From 1, in the order the files were sent. */
    position: integer("position").notNull(),
    kind: documentFileKind("kind").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    /** Where it's kept: documents/<document id>/<position>.<extension>. */
    storageKey: text("storage_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("document_files_sha256_unique").on(table.sha256),
    uniqueIndex("document_files_storage_key_unique").on(table.storageKey),
    uniqueIndex("document_files_document_position_unique").on(
      table.documentId,
      table.position,
    ),
    check("document_files_position_positive", sql`${table.position} > 0`),
  ],
);

/**
 * The request field each unique index guards: a duplicate answers 409 naming it
 * (src/errors.ts).
 */
export const UNIQUE_FIELDS: Readonly<Record<string, string>> = {
  storerooms_name_unique: "name",
  suppliers_tax_id_unique: "taxId",
  products_name_unique: "name",
  unit_conversions_product_unit_unique: "conversions",
  supplier_products_supplier_code_unique: "code",
  // Two uploads of the same file at the same moment: the one checked first wins (#102).
  document_files_sha256_unique: "files",
};

/**
 * The request field each foreign key comes from: a reference to a row that doesn't exist
 * answers 400, naming it with `not_found` (src/errors.ts).
 */
export const FOREIGN_KEY_FIELDS: Readonly<Record<string, string>> = {
  products_default_storeroom_id_storerooms_id_fk: "defaultStoreroomId",
  supplier_products_supplier_id_suppliers_id_fk: "supplierId",
  supplier_products_product_id_products_id_fk: "productId",
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
    // The supplier document behind the change, if there is one.
    documentId: uuid("document_id").references(() => documents.id),
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
