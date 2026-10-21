import { z } from "zod";
import type { Role } from "./auth";
import type { ExtractedDocument } from "./extraction";
import type { ReviewReason } from "./matching";
import { BaseUnit } from "./products";

// Posting a reviewed delivery note into stock, and reversing a posted document (#119, decision
// 0038): who may post one, what posting it takes, and what a posted document's page is sent,
// its lines and the movements each one made.

/**
 * Whether `role` may post a document of `type` with these reasons left before posting it
 * (decision 0038, spec section 6). Nobody may while anything but a new supplier is left. A
 * counter user, who receives deliveries, only a delivery note, and only when nothing is: a new
 * supplier's documents are reviewed first (spec 11.1). Office and owner, who review and post
 * invoices, may post them (#120).
 */
export function mayPost(
  role: Role,
  left: readonly ReviewReason[],
  type: ExtractedDocument["documentType"],
): boolean {
  if (left.some((reason) => reason !== "new_supplier")) return false;
  if (role !== "counter") return true;
  return type === "delivery-note" && left.length === 0;
}

/**
 * Body of `POST /api/documents/:id/post`: where each line is received, in the draft's order;
 * null for its product's default storeroom (decision 0033).
 */
export const PostDocument = z.strictObject({
  storerooms: z.array(z.uuid().nullable()),
});
export type PostDocument = z.infer<typeof PostDocument>;

/** What caused a movement (packages/ledger's MovementKind). */
export const MOVEMENT_KINDS = [
  "receipt",
  "waste",
  "count",
  "transfer-out",
  "transfer-in",
] as const;

const Named = z.object({ id: z.uuid(), name: z.string() });

/** One stored movement (decision 0034): signed whole base units, and a cost per base unit. */
export const PostedMovement = z.object({
  id: z.uuid(),
  storeroom: Named,
  /** Positive into the storeroom, negative out of it. */
  quantity: z.number().int(),
  /** Per base unit, excluding VAT: 6 decimals, as text ("0.001800"). */
  unitCost: z.string(),
  kind: z.enum(MOVEMENT_KINDS),
  /** The movement this one reverses, if it's a reversal. */
  reverses: z.uuid().nullable(),
  /** The receipt this one corrects at an invoice's price (decision 0032). */
  corrects: z.uuid().nullable(),
});
export type PostedMovement = z.infer<typeof PostedMovement>;

/** One line of a posted document, as posted, and the movements it made. */
export const PostedLine = z.object({
  /** From 1, in the document's order. */
  position: z.number().int().min(1),
  product: z.object({ id: z.uuid(), name: z.string(), baseUnit: BaseUnit }),
  /** As printed, in `unit`: "1.5" cajas. */
  quantity: z.string(),
  unit: z.string(),
  /** Per `unit`, before discount, excluding VAT: 6 decimals, as text. */
  unitPrice: z.string(),
  discountPercent: z.string().nullable(),
  vatRate: z.string().nullable(),
  /** Where it was received; none for an invoice line that bills a delivery note's. */
  storeroom: Named.nullable(),
  movements: z.array(PostedMovement),
});
export type PostedLine = z.infer<typeof PostedLine>;

/**
 * Answer of `GET /api/documents/:id/posting`, and of posting and reversing: a posted document's
 * lines, and its reversal's if it's reversed.
 */
export const DocumentPosting = z.object({
  lines: z.array(PostedLine),
  reversal: z
    .object({
      id: z.uuid(),
      /** The day it was reversed, YYYY-MM-DD. */
      date: z.iso.date(),
      reversedBy: Named,
      /** Copies of the document's lines, with the movements that undid each one. */
      lines: z.array(PostedLine),
    })
    .nullable(),
});
export type DocumentPosting = z.infer<typeof DocumentPosting>;
