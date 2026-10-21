import { PRODUCT_CATEGORIES, type CountSheet } from "@kitchen-ops/shared";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { conversionsOf } from "../catalogue/products";
import { spanishOrder } from "../catalogue/lists";
import type { Db } from "../db/client";
import { products, storerooms } from "../db/schema";
import { currentValuation } from "./list";

// A storeroom's count sheet (#152): what a count of it lists to begin with. The products with
// stock there, more or less than none, as packages/ledger works it out from the movements, and
// the active products whose default storeroom it is; others are added by typing. How much there
// is stays out of it, for every role: a count is blind, and its differences show once posted.

/** The catalogue's categories, in order: a shelf walk from produce to cleaning. */
const categoryOrder = new Map(PRODUCT_CATEGORIES.map((c, i) => [c, i]));

/** The sheet for one storeroom, or undefined if there's no such storeroom. */
export async function countSheet(
  db: Db,
  storeroomId: string,
): Promise<CountSheet | undefined> {
  const [storeroom] = await db
    .select({ id: storerooms.id, name: storerooms.name })
    .from(storerooms)
    .where(eq(storerooms.id, storeroomId));
  if (!storeroom) return undefined;

  const stocked = (await currentValuation(db)).places
    .filter((p) => p.storeroomId === storeroomId && p.onHand !== 0)
    .map((p) => p.productId);
  const found = await db
    .select({
      id: products.id,
      name: products.name,
      baseUnit: products.baseUnit,
      category: products.category,
      defaultStoreroomId: products.defaultStoreroomId,
      active: products.active,
    })
    .from(products)
    .where(
      or(
        stocked.length > 0 ? inArray(products.id, stocked) : undefined,
        and(
          eq(products.defaultStoreroomId, storeroomId),
          eq(products.active, true),
        ),
      ),
    )
    .orderBy(spanishOrder(products.name), asc(products.id));
  // By name already: a stable sort by category keeps names in order within each.
  found.sort(
    (a, b) => categoryOrder.get(a.category)! - categoryOrder.get(b.category)!,
  );
  const conversions = await conversionsOf(
    db,
    found.map((p) => p.id),
  );
  return {
    storeroom,
    products: found.map((p) => ({
      ...p,
      conversions: conversions.get(p.id) ?? [],
    })),
  };
}
