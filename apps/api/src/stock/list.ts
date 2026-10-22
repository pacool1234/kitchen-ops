import * as ledger from "@kitchen-ops/ledger";
import type { StockPage, StockQuery } from "@kitchen-ops/shared";
import { and, asc, count, eq, max } from "drizzle-orm";
import { contains, pageWindow, spanishOrder } from "../catalogue/lists";
import type { Db } from "../db/client";
import { movements, products, storerooms } from "../db/schema";
import { movementsOf } from "../posting/stored";

// Stock per storeroom (#150): every product in every storeroom it has moved through, valued by
// packages/ledger from the stored movements (#148), never summed here, so a correction counts
// in the place of the receipt it corrects (decision 0032). The euros are for office and the
// owner only (spec section 6).

/** The last valuation worked out, and which movements it was worked out from. */
let cached: { movements: string; valuation: ledger.Valuation } | undefined;

/**
 * Every place's stock and value, from every stored movement (decision 0045). Movements are
 * append-only and numbered under the posting lock, so as many of them, up to the same last
 * `sequence`, are the same movements: they're read and valued again only once more are posted.
 */
export async function currentValuation(db: Db): Promise<ledger.Valuation> {
  const [stored] = await db
    .select({ count: count(), last: max(movements.sequence) })
    .from(movements);
  const key = `${stored!.count}:${stored!.last ?? 0}`;
  if (cached?.movements !== key) {
    cached = {
      movements: key,
      valuation: ledger.valuation(await movementsOf(db)),
    };
  }
  return cached.valuation;
}

/** By product name, then storeroom name, in Spanish order; a page at a time. */
export async function stockList(
  db: Db,
  query: Pick<StockQuery, "page" | "pageSize"> &
    Partial<Pick<StockQuery, "q" | "category" | "storeroomId" | "productId">>,
  { costs }: { costs: boolean },
): Promise<StockPage> {
  const [valuation, found, rooms] = await Promise.all([
    currentValuation(db),
    db
      .select({
        id: products.id,
        name: products.name,
        baseUnit: products.baseUnit,
        category: products.category,
      })
      .from(products)
      .where(
        and(
          query.q ? contains(products.name, query.q) : undefined,
          query.category ? eq(products.category, query.category) : undefined,
          query.productId ? eq(products.id, query.productId) : undefined,
        ),
      )
      .orderBy(spanishOrder(products.name), asc(products.id)),
    db
      .select({ id: storerooms.id, name: storerooms.name })
      .from(storerooms)
      .orderBy(spanishOrder(storerooms.name), asc(storerooms.id)),
  ]);
  // Each product and storeroom by ID, with its place in the order.
  const productAt = new Map(
    found.map((p, i) => [p.id, { about: p, order: i }]),
  );
  const roomAt = new Map(rooms.map((r, i) => [r.id, { about: r, order: i }]));

  const places = valuation.places
    .filter(
      (p) =>
        productAt.has(p.productId) &&
        (query.storeroomId === undefined ||
          p.storeroomId === query.storeroomId),
    )
    .sort(
      (a, b) =>
        productAt.get(a.productId)!.order - productAt.get(b.productId)!.order ||
        roomAt.get(a.storeroomId)!.order - roomAt.get(b.storeroomId)!.order,
    );
  const { limit, offset } = pageWindow(query);
  return {
    items: places.slice(offset, offset + limit).map((p) => ({
      product: productAt.get(p.productId)!.about,
      storeroom: roomAt.get(p.storeroomId)!.about,
      onHand: p.onHand,
      ...(costs
        ? {
            averageCost: ledger.formatUnitCost(p.averageCost),
            value: ledger.formatMoney(p.value),
          }
        : {}),
    })),
    total: places.length,
    page: query.page,
    pageSize: query.pageSize,
    // The whole stock's, whatever was searched or filtered.
    ...(costs
      ? {
          totals: {
            storerooms: rooms
              .filter((r) => valuation.storerooms.has(r.id))
              .map((storeroom) => ({
                storeroom,
                value: ledger.formatMoney(
                  valuation.storerooms.get(storeroom.id)!,
                ),
              })),
            value: ledger.formatMoney(valuation.total),
          },
        }
      : {}),
  };
}
