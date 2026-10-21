import type {
  ProductMovementPage,
  ProductMovementQuery,
} from "@kitchen-ops/shared";
import { and, count, desc, eq } from "drizzle-orm";
import { pageWindow } from "../catalogue/lists";
import type { Db } from "../db/client";
import {
  documentLines,
  documents,
  movements,
  products,
  storerooms,
} from "../db/schema";

// The movements behind a product's stock (#150), newest first, each with the document it came
// from. Their costs are for office and the owner only (spec section 6).

/** A page of the product's movements; undefined if there's no such product. */
export async function productMovements(
  db: Db,
  productId: string,
  query: Pick<ProductMovementQuery, "page" | "pageSize"> &
    Partial<Pick<ProductMovementQuery, "storeroomId">>,
  { costs }: { costs: boolean },
): Promise<ProductMovementPage | undefined> {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) return undefined;

  const theirs = and(
    eq(movements.productId, productId),
    query.storeroomId === undefined
      ? undefined
      : eq(movements.storeroomId, query.storeroomId),
  );
  const { limit, offset } = pageWindow(query);
  const [rows, [counted]] = await Promise.all([
    db
      .select({
        movement: movements,
        storeroom: { id: storerooms.id, name: storerooms.name },
        document: {
          id: documents.id,
          type: documents.type,
          number: documents.number,
          reverses: documents.reverses,
          date: documents.date,
        },
      })
      .from(movements)
      .innerJoin(storerooms, eq(storerooms.id, movements.storeroomId))
      .innerJoin(documentLines, eq(documentLines.id, movements.documentLineId))
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(theirs)
      .orderBy(desc(movements.sequence))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(movements).where(theirs),
  ]);
  return {
    items: rows.map(({ movement, storeroom, document }) => {
      // A movement's document is posted (invariant 2), so it has its type and date.
      const { type, date, ...link } = document;
      return {
        id: movement.id,
        kind: movement.kind,
        storeroom,
        quantity: movement.quantity,
        ...(costs ? { unitCost: movement.unitCost } : {}),
        adjustment: movement.adjustment,
        date: date!,
        document: { ...link, type: type! },
      };
    }),
    total: counted!.total,
    page: query.page,
    pageSize: query.pageSize,
  };
}
