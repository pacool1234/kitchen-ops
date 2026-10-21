import * as ledger from "@kitchen-ops/ledger";
import type { ProductStock } from "@kitchen-ops/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { products, storerooms } from "../db/schema";
import { movementsOf } from "../posting/stored";

// A product's stock and average cost in each storeroom (#120), for its page: worked out by
// packages/ledger from the product's stored movements, as posting does, never summed here, so
// a correction counts in the place of the receipt it corrects (decision 0032).

/** By storeroom name; undefined if there's no such product. */
export async function productStock(
  db: Db,
  productId: string,
): Promise<ProductStock | undefined> {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) return undefined;
  const moved = await movementsOf(db, [productId]);
  const ids = [...new Set(moved.map((m) => m.storeroomId))];
  const rooms =
    ids.length === 0
      ? []
      : await db
          .select({ id: storerooms.id, name: storerooms.name })
          .from(storerooms)
          .where(inArray(storerooms.id, ids))
          .orderBy(asc(storerooms.name));
  return {
    storerooms: rooms.map((storeroom) => ({
      storeroom,
      onHand: ledger.stockOnHand(moved, productId, storeroom.id),
      averageCost: ledger.formatUnitCost(
        ledger.averageCost(moved, productId, storeroom.id),
      ),
    })),
  };
}
