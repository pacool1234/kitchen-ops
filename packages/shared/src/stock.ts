import { z } from "zod";
import type { Role } from "./auth";
import { EXTRACTED_DOCUMENT_TYPES } from "./extraction";
import { fieldError } from "./errors";
import { optionalText } from "./fields";
import { PageQuery, pageOf, SearchText } from "./lists";
import { MOVEMENT_KINDS } from "./posting";
import { BaseUnit, ProductCategory, UnitName } from "./products";
import { decimalQuantity, PackQuantity } from "./supplier-products";

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

/** One counted line: as a stock line, but 0 is a count too, "none left". */
export const CountLine = StockLine.extend({
  quantity: decimalQuantity({ zero: true }),
});
export type CountLine = z.infer<typeof CountLine>;

/**
 * Body of `PUT /api/counts/:id`: what was counted in a storeroom, and when. A count made offline
 * is synced later (#153); it's measured against the stock as it was when it was counted.
 */
export const RecordCount = z.strictObject({
  storeroomId: z.uuid(),
  /** With its offset, kept as UTC: the same instant, however it's written, is the same count. */
  countedAt: z.iso
    .datetime({ offset: true })
    .transform((at) => new Date(at).toISOString()),
  lines: z
    .array(CountLine)
    .min(1)
    .max(MAX_STOCK_LINES)
    .superRefine((lines, ctx) => {
      // Two counts of one product in one place can't both be true.
      const seen = new Set<string>();
      lines.forEach(({ productId }, i) => {
        if (seen.has(productId)) {
          ctx.addIssue({
            code: "custom",
            path: [i, "productId"],
            message: "counted twice",
            ...fieldError("taken"),
          });
        }
        seen.add(productId);
      });
    }),
});
export type RecordCount = z.input<typeof RecordCount>;

/**
 * Who sees what stock costs and is worth (spec section 6): office and the owner. Counter users
 * get quantities only; the API leaves the euros out of their answers (#150).
 */
export function seesCosts(role: Role): boolean {
  return role === "office" || role === "owner";
}

const Named = z.object({ id: z.uuid(), name: z.string() });

/** Query of `GET /api/stock`. */
export const StockQuery = PageQuery.extend({
  /** In the product's name. */
  q: SearchText,
  category: ProductCategory.optional(),
  storeroomId: z.uuid().optional(),
  /** One product's stock in each storeroom: its own page's. */
  productId: z.uuid().optional(),
});
export type StockQuery = z.infer<typeof StockQuery>;

/** One product in one storeroom it has moved through (#150). */
export const StockPlace = z.object({
  product: z.object({
    id: z.uuid(),
    name: z.string(),
    baseUnit: BaseUnit,
    category: ProductCategory,
  }),
  storeroom: Named,
  /** Whole base units: the sum of its movements (ledger invariant 1). */
  onHand: z.number().int(),
  /** Office and the owner only. Per base unit, 6 decimals as text (decision 0015). */
  averageCost: z.string().optional(),
  /** Office and the owner only. On hand × average cost in euros, rounded to cents (decision 0043). */
  value: z.string().optional(),
});
export type StockPlace = z.infer<typeof StockPlace>;

/** What the whole stock is worth, whatever the search and filters: office and the owner only. */
export const StockTotals = z.object({
  /** Each storeroom with movements, by name: the sum of its places' values. */
  storerooms: z.array(z.object({ storeroom: Named, value: z.string() })),
  /** The sum of the storerooms' values. */
  value: z.string(),
});
export type StockTotals = z.infer<typeof StockTotals>;

/** Answer of `GET /api/stock`: by product name, then storeroom name. */
export const StockPage = pageOf(StockPlace).extend({
  totals: StockTotals.optional(),
});
export type StockPage = z.infer<typeof StockPage>;

/** Query of `GET /api/products/:id/movements`. */
export const ProductMovementQuery = PageQuery.extend({
  storeroomId: z.uuid().optional(),
});
export type ProductMovementQuery = z.infer<typeof ProductMovementQuery>;

/** One of a product's stored movements, with the document it came from (#150). */
export const ProductMovement = z.object({
  id: z.uuid(),
  kind: z.enum(MOVEMENT_KINDS),
  storeroom: Named,
  /** Whole base units, signed: positive into the storeroom, negative out of it. */
  quantity: z.number().int(),
  /** Office and the owner only. Per base unit, 6 decimals as text. */
  unitCost: z.string().optional(),
  /** A flagged adjustment: it may take stock below zero (invariant 6). */
  adjustment: z.boolean(),
  /** Its document's date, YYYY-MM-DD. */
  date: z.iso.date(),
  document: z.object({
    id: z.uuid(),
    type: z.enum(STORED_DOCUMENT_TYPES),
    number: z.string().nullable(),
    /** For a reversal, the document it reverses: the page that shows both. */
    reverses: z.uuid().nullable(),
  }),
});
export type ProductMovement = z.infer<typeof ProductMovement>;

/** Answer of `GET /api/products/:id/movements`: newest first. */
export const ProductMovementPage = pageOf(ProductMovement);
export type ProductMovementPage = z.infer<typeof ProductMovementPage>;
