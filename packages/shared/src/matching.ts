import { z } from "zod";
import { Pack, SupplierProduct } from "./supplier-products";

// Matching a document to the catalogue (#117, decision 0035): its supplier, found by tax ID or
// chosen in review, and each line's supplier product, by code, then by exact description. A
// person confirms a new mapping once, and it's remembered as a supplier product.

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
  /** At least one line isn't matched to a supplier product. */
  "unmapped_lines",
] as const;
export const ReviewReason = z.enum(REVIEW_REASONS);
export type ReviewReason = z.infer<typeof ReviewReason>;

/** How a line was matched: by the supplier's code, or by its exact description. */
export const MATCHED_BY = ["code", "description"] as const;
export const MatchedBy = z.enum(MATCHED_BY);
export type MatchedBy = z.infer<typeof MatchedBy>;

export const LineMatch = z.object({
  by: MatchedBy,
  supplierProduct: SupplierProduct,
});
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
    }),
  ),
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
