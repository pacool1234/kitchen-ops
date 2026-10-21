import { z } from "zod";
import { EXTRACTED_DOCUMENT_TYPES } from "./extraction";
import { optionalText } from "./fields";
import { UnitName } from "./products";
import { PackQuantity } from "./supplier-products";

// A product's stock and average cost in each storeroom (#120): what its page shows office and
// the owner, so an invoice's correction can be seen. M8 adds its value and the movements
// behind it (spec 11.4).

/** One storeroom the product has moved through. */
export const StoreroomStock = z.object({
  storeroom: z.object({ id: z.uuid(), name: z.string() }),
  /** Whole base units: the sum of its movements (ledger invariant 1). */
  onHand: z.number().int(),
  /** Per base unit, 6 decimals as text: the weighted average (decision 0015). */
  averageCost: z.string(),
});
export type StoreroomStock = z.infer<typeof StoreroomStock>;

/** Answer of `GET /api/products/:id/stock`: by storeroom name. */
export const ProductStock = z.object({ storerooms: z.array(StoreroomStock) });
export type ProductStock = z.infer<typeof ProductStock>;

/**
 * Waste, counts and transfers (#149, decision 0044): stock documents that staff record, rather
 * than a supplier's read from a file. Each is posted as it's recorded.
 */
export const STOCK_DOCUMENT_TYPES = ["waste", "count", "transfer"] as const;
export type StockDocumentType = (typeof STOCK_DOCUMENT_TYPES)[number];

/** Every document's type, as stored: a supplier's, once read, or a stock document. */
export const STORED_DOCUMENT_TYPES = [
  ...EXTRACTED_DOCUMENT_TYPES,
  ...STOCK_DOCUMENT_TYPES,
] as const;

/** Why stock was thrown away (#149): a fixed list, so reports can group waste by it (M9). */
export const WASTE_REASONS = [
  "expired",
  "spoiled",
  "broken",
  "prep_error",
  "other",
] as const;
export const WasteReason = z.enum(WASTE_REASONS);
export type WasteReason = z.infer<typeof WasteReason>;

/** The most lines one stock document takes: a count of a whole storeroom fits. */
export const MAX_STOCK_LINES = 500;

/** One line: a quantity of a product in one of its units, its base unit included. */
export const StockLine = z.strictObject({
  productId: z.uuid(),
  quantity: PackQuantity,
  unit: UnitName,
});
export type StockLine = z.infer<typeof StockLine>;

const StockLines = z.array(StockLine).min(1).max(MAX_STOCK_LINES);

/** Body of `PUT /api/waste/:id`: what was thrown away, from where, and why. */
export const RecordWaste = z.strictObject({
  storeroomId: z.uuid(),
  reason: WasteReason,
  /** A few words more, if the reason needs them; blank is none. */
  note: optionalText(200)
    .optional()
    .transform((note) => note ?? null),
  lines: StockLines,
});
export type RecordWaste = z.input<typeof RecordWaste>;

/** Body of `PUT /api/transfers/:id`: stock moved from one storeroom to another. */
export const RecordTransfer = z.strictObject({
  storeroomId: z.uuid(),
  toStoreroomId: z.uuid(),
  lines: StockLines,
});
export type RecordTransfer = z.input<typeof RecordTransfer>;
