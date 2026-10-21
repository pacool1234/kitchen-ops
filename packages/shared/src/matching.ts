import { z } from "zod";
import { LineBilling } from "./billing";
import { BaseUnit } from "./products";
import { Pack, SupplierProduct } from "./supplier-products";

// Matching a document to the catalogue (#117, decisions 0035 and 0036): its supplier, found by
// tax ID or chosen in review, and each line's supplier product, by code, then by exact
// description, or else a model's suggestion of one of our products. A person confirms a new
// mapping once, and it's remembered as a supplier product.

/** A supplier is new until it has this many posted documents (spec 11.1, decision 0035). */
export const NEW_SUPPLIER_DOCUMENTS = 3;

/** Why a document needs a person's review before it's posted. */
export const REVIEW_REASONS = [
  /** The model's answer didn't fit the schema: there's nothing read to post. */
  "no_draft",
  /** What was read failed one of the checks (spec section 5, stage 4). */
  "failed_checks",
  /** No supplier of ours has the tax ID read, and none has been chosen. */
  "no_supplier",
  /** Its supplier has fewer than NEW_SUPPLIER_DOCUMENTS posted documents (spec 11.1). */
  "new_supplier",
  /**
   * At least one line isn't matched to a supplier product: a suggestion isn't a match yet. On an
   * invoice, only the lines received with it: a line it bills is the delivery note's product.
   */
  "unmapped_lines",
  /** An invoice line bills no delivery-note line, nor is it received with it (#120). */
  "unbilled_lines",
  /** An invoice line bills a delivery-note line with another quantity (decision 0032). */
  "quantity_differs",
] as const;
export const ReviewReason = z.enum(REVIEW_REASONS);
export type ReviewReason = z.infer<typeof ReviewReason>;

/** How a line was matched to a supplier product: by the supplier's code, or its exact description. */
export const MATCHED_BY = ["code", "description"] as const;
export const MatchedBy = z.enum(MATCHED_BY);
export type MatchedBy = z.infer<typeof MatchedBy>;

/**
 * A line's supplier product, or, when none matched, the product a model suggested (decision
 * 0036): never applied until a person confirms it as a mapping.
 */
export const LineMatch = z.discriminatedUnion("by", [
  z.object({ by: MatchedBy, supplierProduct: SupplierProduct }),
  z.object({
    by: z.literal("suggestion"),
    product: z.object({ id: z.uuid(), name: z.string(), baseUnit: BaseUnit }),
  }),
]);
export type LineMatch = z.infer<typeof LineMatch>;

/** Answer of `GET /api/documents/:id/matching`, and of the writes that change it. */
export const DocumentMatching = z.object({
  supplier: z
    .object({ id: z.uuid(), name: z.string(), taxId: z.string() })
    .nullable(),
  /** Whether its supplier is new (spec 11.1); false when it has none. */
  newSupplier: z.boolean(),
  /** One per line of the draft, in order: `line` from 1. */
  lines: z.array(
    z.object({
      line: z.number().int().min(1),
      match: LineMatch.nullable(),
      /** What an invoice's line bills (#120): null for a delivery note's, and for one undecided. */
      billing: LineBilling.nullable(),
    }),
  ),
  /**
   * An invoice's lines' differences added up, in euros: what it changes the delivery notes'
   * value by. Null for a delivery note.
   */
  difference: z.string().nullable(),
  /** Empty when nothing stands in the way of posting it. */
  reviewReasons: z.array(ReviewReason),
});
export type DocumentMatching = z.infer<typeof DocumentMatching>;

/** Body of `PUT /api/documents/:id/supplier`. */
export const DocumentSupplier = z.strictObject({ supplierId: z.uuid() });
export type DocumentSupplier = z.infer<typeof DocumentSupplier>;

/** A line of a document, in a path: `/api/documents/:id/lines/:line`, from 1. */
export const LineParams = z.object({
  id: z.uuid(),
  line: z.coerce.number().int().min(1),
});

/**
 * Body of `POST /api/documents/:id/lines/:line/mapping`: the product the line is, and what the
 * line's unit holds. The code and description come from the line itself.
 */
export const NewMapping = z.strictObject({
  productId: z.uuid(),
  pack: Pack,
});
export type NewMapping = z.infer<typeof NewMapping>;
