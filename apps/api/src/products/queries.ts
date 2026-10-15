import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { products } from "../db/schema";

/** Active products, sorted by name: what staff pick from when counting or receiving. */
export function listActiveProducts(db: Db) {
  return db
    .select({
      id: products.id,
      name: products.name,
      baseUnit: products.baseUnit,
      active: products.active,
    })
    .from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.name));
}
