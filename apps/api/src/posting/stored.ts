import {
  formatUnitCost,
  parseUnitCost,
  type Movement,
  type UnitConversion,
} from "@kitchen-ops/ledger";
import { and, asc, count, inArray, lte, max, sql } from "drizzle-orm";
import type { Tx } from "../audit/audited";
import { ledgerConversions } from "../catalogue/conversions";
import type { Db } from "../db/client";
import { movements, products, unitConversions } from "../db/schema";

// Movements as the database stores them and as packages/ledger takes them (decision 0034): the
// same fields, a unit cost as 6-decimal text in one and bigint millionths in the other, and
// the list order kept in `sequence`.

type Reader = Db | Tx;
type MovementRow = typeof movements.$inferSelect;

/** A stored movement as the ledger's: its links and flag only when set, as the ledger makes them. */
export function movementFromRow(row: MovementRow): Movement {
  return {
    id: row.id,
    productId: row.productId,
    storeroomId: row.storeroomId,
    quantity: row.quantity,
    unitCost: parseUnitCost(row.unitCost),
    documentLineId: row.documentLineId,
    kind: row.kind,
    ...(row.reverses === null ? {} : { reverses: row.reverses }),
    ...(row.corrects === null ? {} : { corrects: row.corrects }),
    ...(row.adjustment ? { adjustment: true as const } : {}),
  };
}

/**
 * A ledger movement as a row, stamped with when it was posted: the database's time once the
 * posting lock was taken. The database numbers its `sequence`.
 */
export function movementToRow(
  movement: Movement,
  postedAt: Date,
): typeof movements.$inferInsert {
  return {
    id: movement.id,
    productId: movement.productId,
    storeroomId: movement.storeroomId,
    quantity: movement.quantity,
    unitCost: formatUnitCost(movement.unitCost),
    documentLineId: movement.documentLineId,
    kind: movement.kind,
    reverses: movement.reverses ?? null,
    corrects: movement.corrects ?? null,
    adjustment: movement.adjustment === true,
    createdAt: postedAt,
  };
}

/**
 * Stored movements in the ledger's order, their `sequence`: every one, or those of the products
 * given. The ledger works per product, so a product's own movements give it everything it needs.
 */
export async function movementsOf(
  db: Reader,
  productIds?: readonly string[],
): Promise<Movement[]> {
  if (productIds?.length === 0) return [];
  const rows = await db
    .select()
    .from(movements)
    .where(
      productIds === undefined
        ? undefined
        : inArray(movements.productId, [...productIds]),
    )
    .orderBy(asc(movements.sequence));
  return rows.map(movementFromRow);
}

/**
 * How many of the products' movements were posted by `at`: the first so many of
 * `movementsOf(db, productIds)`, which a count made then saw (decision 0043). A count made
 * offline is synced after movements it never saw (#153). Taken as the movements up to the last
 * one stamped by then, so it's always a prefix of the list.
 */
export async function postedBefore(
  db: Reader,
  productIds: readonly string[],
  at: Date,
): Promise<number> {
  if (productIds.length === 0) return 0;
  const theirs = inArray(movements.productId, [...productIds]);
  const last = db
    .select({ sequence: max(movements.sequence) })
    .from(movements)
    .where(and(theirs, lte(movements.createdAt, at)));
  const [row] = await db
    .select({ posted: count() })
    .from(movements)
    .where(and(theirs, lte(movements.sequence, sql`(${last})`)));
  return row!.posted;
}

/** The products' unit conversions as the ledger takes them, their base units' own included. */
export async function conversionsOf(
  db: Reader,
  productIds: readonly string[],
): Promise<UnitConversion[]> {
  if (productIds.length === 0) return [];
  const [found, conversions] = await Promise.all([
    db
      .select({ id: products.id, baseUnit: products.baseUnit })
      .from(products)
      .where(inArray(products.id, [...productIds])),
    db
      .select()
      .from(unitConversions)
      .where(inArray(unitConversions.productId, [...productIds])),
  ]);
  return found.flatMap((product) =>
    ledgerConversions({
      ...product,
      conversions: conversions
        .filter((c) => c.productId === product.id)
        .map(({ unit, factor }) => ({ unit, factor })),
    }),
  );
}
