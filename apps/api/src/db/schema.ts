import {
  AUDIT_ACTIONS,
  DOCUMENT_STATUSES,
  EXTRACTION_FAILURES,
  FILE_KINDS,
  BASE_UNITS,
  PRODUCT_CATEGORIES,
  STOCK_DOCUMENT_TYPES,
  STOREROOM_TYPES,
  STORED_DOCUMENT_TYPES,
  WASTE_REASONS,
} from "@kitchen-ops/shared";
import type { CheckFailure } from "@kitchen-ops/extract";
import type { MovementKind } from "@kitchen-ops/ledger";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
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
import { createdAt, primaryId, storedDraft, updatedAt } from "./columns";

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
    /** Null when the supplier prints no code (decision 0035). Unique per supplier when set. */
    code: text("code"),
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
/**
 * A delivery note or an invoice, once read, or a stock document: waste, a count or a transfer,
 * recorded by staff (#149, decision 0044).
 */
export const documentType = pgEnum("document_type", STORED_DOCUMENT_TYPES);
/** Why stock was thrown away (#149); values come from packages/shared. */
export const wasteReason = pgEnum("waste_reason", WASTE_REASONS);
/** The stock documents' types, as SQL for the checks below: ('waste', 'count', 'transfer'). */
const STOCK_TYPES = `(${STOCK_DOCUMENT_TYPES.map((t) => `'${t}'`).join(", ")})`;
export const documentFileKind = pgEnum("document_file_kind", FILE_KINDS);
/** Why reading a document failed (#104); values come from packages/shared. */
export const extractionFailure = pgEnum(
  "extraction_failure",
  EXTRACTION_FAILURES,
);

/**
 * A supplier document (spec section 3, #102): one PDF or Facturae file, or one or several photos,
 * on its way to review. Its type, supplier, number and date are filled in once it's read (#104).
 *
 * Or a stock document (#149, decision 0044): waste, a count or a transfer, recorded by staff and
 * posted at once. It has no files and no supplier, but a storeroom, and an ID the client made.
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
    /** What extraction read (#104), for review (M7). Null until read, or if it couldn't be. */
    draft: storedDraft("draft"),
    /**
     * The draft as corrected in review (#118, decision 0037), whole. Null until a correction is
     * saved; `draft` stays what was read.
     */
    corrected: storedDraft("corrected"),
    /**
     * The checks the draft failed, the corrected one if there is one: names and paths, and
     * messages that may quote the document.
     */
    checkFailures: jsonb("check_failures").$type<readonly CheckFailure[]>(),
    /** Why it needs review without a draft: the model's answer didn't match the schema… */
    reviewNote: text("review_note"),
    /** Set exactly when the status is `failed`. */
    failureReason: extractionFailure("failure_reason"),
    /**
     * The posted document this one reverses (decision 0034): a reversal is a posted document of
     * its own, with no files. At most one reversal per document.
     */
    reverses: uuid("reverses").references((): AnyPgColumn => documents.id),
    /**
     * The reversed document this one is a corrected copy of (#119, decision 0038): reviewed and
     * posted in its place. Its files are that one's. At most one copy per document.
     */
    copyOf: uuid("copy_of").references((): AnyPgColumn => documents.id),
    /** A stock document's storeroom: where waste or a count was, or a transfer's source. */
    storeroomId: uuid("storeroom_id").references(() => storerooms.id),
    /** A transfer's destination. */
    toStoreroomId: uuid("to_storeroom_id").references(() => storerooms.id),
    /** Why waste was thrown away. */
    wasteReason: wasteReason("waste_reason"),
    /** A few words more about waste, if its reason needs them. */
    note: text("note"),
    /** When a count was made, which may be well before it reached us: offline (#153). */
    countedAt: timestamp("counted_at", { withTimezone: true }),
    /**
     * The sha256 of the request that recorded a stock document: the same ID sent again with the
     * same body answers what was posted, and with another one is refused.
     */
    requestSha256: text("request_sha256"),
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
    check(
      "documents_failure_reason_when_failed",
      sql`(${table.status} = 'failed') = (${table.failureReason} is not null)`,
    ),
    // What posting needs to know, kept with the posted document. Compared as text: the
    // migration that adds `posted` can't use it as an enum value in the same transaction.
    // A supplier's document names its supplier; a stock document has none (#149).
    check(
      "documents_posted_complete",
      sql`${table.status}::text <> 'posted' or (${table.type} is not null and ${table.date} is not null and (${table.supplierId} is not null or ${table.type}::text in ${sql.raw(STOCK_TYPES)}))`,
    ),
    // What each stock document needs, and only it (#149). Compared as text, as above.
    check(
      "documents_stock_storeroom",
      sql`coalesce(${table.type}::text in ${sql.raw(STOCK_TYPES)}, false) = (${table.storeroomId} is not null)`,
    ),
    check(
      "documents_waste_reason",
      sql`coalesce(${table.type}::text = 'waste', false) = (${table.wasteReason} is not null)`,
    ),
    check(
      "documents_waste_note",
      sql`${table.note} is null or ${table.type}::text = 'waste'`,
    ),
    check(
      "documents_transfer_destination",
      sql`coalesce(${table.type}::text = 'transfer', false) = (${table.toStoreroomId} is not null)`,
    ),
    check(
      "documents_transfer_elsewhere",
      sql`${table.toStoreroomId} is null or ${table.toStoreroomId} <> ${table.storeroomId}`,
    ),
    check(
      "documents_count_counted_at",
      sql`coalesce(${table.type}::text = 'count', false) = (${table.countedAt} is not null)`,
    ),
    check(
      "documents_request_sha256",
      sql`${table.requestSha256} is null or ${table.type}::text in ${sql.raw(STOCK_TYPES)}`,
    ),
    check(
      "documents_reversal_posted",
      sql`${table.reverses} is null or ${table.status}::text = 'posted'`,
    ),
    uniqueIndex("documents_reverses_unique").on(table.reverses),
    uniqueIndex("documents_copy_of_unique").on(table.copyOf),
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
 * One line of a posted document (spec section 3, decision 0034), written when it's posted and
 * never changed: a trigger refuses updates and deletes (migration 0011). Its ID is the ledger's
 * document line ID, which its movements point to (invariant 2).
 */
export const documentLines = pgTable(
  "document_lines",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    /** From 1, in the document's order. */
    position: integer("position").notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    /** As printed, in `unit`: "1.5" boxes. A decimal read and written as text. */
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull(),
    unit: text("unit").notNull(),
    /**
     * Per purchase unit, before discount, excluding VAT (decision 0015). None for a stock
     * document's line (#149): its movements carry the average cost.
     */
    unitPrice: numeric("unit_price", { precision: 18, scale: 6 }),
    discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }),
    vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
    /** Where the line was received, if not the document's storeroom (decision 0033). */
    storeroomId: uuid("storeroom_id").references(() => storerooms.id),
    /** For an invoice line: the delivery-note line it bills (decision 0032). */
    billsLineId: uuid("bills_line_id").references(
      (): AnyPgColumn => documentLines.id,
    ),
    /** A flagged adjustment: it may take stock below zero (invariant 6). */
    adjustment: boolean("adjustment").notNull().default(false),
    /**
     * The supplier product the line was matched to, whose pack it was received at (decision
     * 0038). None for a line posted without one.
     */
    supplierProductId: uuid("supplier_product_id").references(
      () => supplierProducts.id,
    ),
  },
  (table) => [
    uniqueIndex("document_lines_document_position_unique").on(
      table.documentId,
      table.position,
    ),
    index("document_lines_bills_line_idx").on(table.billsLineId),
    check("document_lines_position_positive", sql`${table.position} > 0`),
  ],
);

/**
 * What a line of an invoice in review bills, as office or the owner confirmed it (#120, decision
 * 0041): a posted delivery-note line, or nothing, received with the invoice. Suggestions aren't
 * stored: they're worked out each time. `position` is the line's in the draft, from 1; choices
 * are cleared when a correction adds or removes lines.
 */
export const invoiceLineBills = pgTable(
  "invoice_line_bills",
  {
    id: primaryId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    position: integer("position").notNull(),
    deliveryNoteLineId: uuid("delivery_note_line_id").references(
      () => documentLines.id,
    ),
    received: boolean("received").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("invoice_line_bills_document_position_unique").on(
      table.documentId,
      table.position,
    ),
    index("invoice_line_bills_delivery_note_line_idx").on(
      table.deliveryNoteLineId,
    ),
    check("invoice_line_bills_position_positive", sql`${table.position} > 0`),
    // One choice: a delivery-note line, or received with the invoice.
    check(
      "invoice_line_bills_one_choice",
      sql`(${table.deliveryNoteLineId} is not null) <> ${table.received}`,
    ),
  ],
);

/** What caused a movement: packages/ledger's MovementKind, every one (schema.test.ts). */
export const MOVEMENT_KINDS = [
  "receipt",
  "waste",
  "count",
  "transfer-out",
  "transfer-in",
] as const satisfies readonly MovementKind[];
export const movementKind = pgEnum("movement_kind", MOVEMENT_KINDS);

/**
 * One append-only change to stock (spec section 3, decision 0034): a ledger movement, stored.
 * Never changed: a trigger refuses updates and deletes (migration 0011). `sequence` is the
 * ledger's list order: read movements back ordered by it.
 */
export const movements = pgTable(
  "movements",
  {
    /** The ledger's movement ID. */
    id: uuid("id").primaryKey(),
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    storeroomId: uuid("storeroom_id")
      .notNull()
      .references(() => storerooms.id),
    /** Whole base units, signed: positive into the storeroom, negative out of it. */
    quantity: bigint("quantity", { mode: "number" }).notNull(),
    /** Per base unit, 6 decimals (decision 0015), read and written as text. */
    unitCost: numeric("unit_cost", { precision: 18, scale: 6 }).notNull(),
    documentLineId: uuid("document_line_id")
      .notNull()
      .references(() => documentLines.id),
    kind: movementKind("kind").notNull(),
    reverses: uuid("reverses").references((): AnyPgColumn => movements.id),
    /** The receipt this one corrects at an invoice's price (decision 0032). */
    corrects: uuid("corrects").references((): AnyPgColumn => movements.id),
    adjustment: boolean("adjustment").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("movements_sequence_unique").on(table.sequence),
    uniqueIndex("movements_reverses_unique").on(table.reverses),
    uniqueIndex("movements_corrects_unique").on(table.corrects),
    index("movements_product_storeroom_idx").on(
      table.productId,
      table.storeroomId,
      table.sequence,
    ),
    index("movements_document_line_idx").on(table.documentLineId),
  ],
);

/** How one try at reading a document ended (#104). */
export const extractionOutcome = pgEnum("extraction_outcome", [
  "extracted",
  "needs_review",
  "rejected",
  "failed",
]);

/**
 * One try at reading a document (#104): what it called, what that cost and how it ended. A job
 * tries up to 3 times; a retry from the app is a new job. A Facturae file, read without a model,
 * has no model and costs nothing.
 */
export const extractionAttempts = pgTable(
  "extraction_attempts",
  {
    id: primaryId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    /** The pg-boss job, and which of its tries this was, from 1. */
    jobId: text("job_id").notNull(),
    try: integer("try").notNull(),
    outcome: extractionOutcome("outcome").notNull(),
    /** For a `failed` or `rejected` try. */
    failureReason: extractionFailure("failure_reason"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    /** Calls to the model in this try: 2 when the first answer didn't match the schema. */
    modelCalls: integer("model_calls").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    /** Millionths of a US dollar, a whole number; null if OpenRouter didn't report it. */
    costMicroUsd: integer("cost_micro_usd"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (table) => [
    index("extraction_attempts_document_idx").on(table.documentId),
    check("extraction_attempts_try_positive", sql`${table.try} > 0`),
  ],
);

/** How a call suggesting products went (decision 0036): answered, or not, with what it cost. */
export const suggestionOutcome = pgEnum("suggestion_outcome", [
  "suggested",
  "failed",
]);

/**
 * Each call asking a model which of our products a document's unmatched lines are (#117,
 * decision 0036), made once when the document is read, with what it cost. Its cost is the
 * document's, like its reading's.
 */
export const suggestionCalls = pgTable(
  "suggestion_calls",
  {
    id: primaryId(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    outcome: suggestionOutcome("outcome").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** 2 when the first answer didn't match the schema. */
    modelCalls: integer("model_calls").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    /** Millionths of a US dollar, a whole number; null if OpenRouter didn't report it. */
    costMicroUsd: integer("cost_micro_usd"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (table) => [index("suggestion_calls_document_idx").on(table.documentId)],
);

/**
 * What the model answered for each line asked about: found again by the line's code and
 * description as read, not its position, so lines moved in review keep theirs.
 */
export const lineSuggestions = pgTable(
  "line_suggestions",
  {
    id: primaryId(),
    callId: uuid("call_id")
      .notNull()
      .references(() => suggestionCalls.id),
    supplierCode: text("supplier_code"),
    description: text("description"),
    /** null: the model found none of our products clearly is the line. */
    productId: uuid("product_id").references(() => products.id),
  },
  (table) => [index("line_suggestions_call_idx").on(table.callId)],
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
