import { z } from "zod";

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
