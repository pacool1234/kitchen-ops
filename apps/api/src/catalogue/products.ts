import {
  checkConversions,
  endpoints,
  type Product,
  type ProductPage,
  type UnitConversion,
} from "@kitchen-ops/shared";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext, type Tx } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { products, supplierProducts, unitConversions } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { packsBroken } from "./conversions";
import { contains, pageWindow, spanishOrder, withStatus } from "./lists";

// Products (#88): what is bought, counted and cooked. Each has a base unit, fixed once it's
// created, a category, a default storeroom and its unit conversions, which are read and written
// with it. Everyone signed in reads them; office and owner change them. Every change is audited.

/** A product's own columns, as the API answers them (`Product` without its conversions). */
const product = {
  id: products.id,
  name: products.name,
  baseUnit: products.baseUnit,
  category: products.category,
  defaultStoreroomId: products.defaultStoreroomId,
  active: products.active,
};

/** Each product's conversions, smallest factor first. */
export async function conversionsOf(
  db: Db | Tx,
  productIds: readonly string[],
): Promise<Map<string, UnitConversion[]>> {
  const byProduct = new Map<string, UnitConversion[]>();
  if (productIds.length === 0) return byProduct;
  const rows = await db
    .select({
      productId: unitConversions.productId,
      unit: unitConversions.unit,
      factor: unitConversions.factor,
    })
    .from(unitConversions)
    .where(inArray(unitConversions.productId, [...productIds]))
    .orderBy(asc(unitConversions.factor), spanishOrder(unitConversions.unit));
  for (const { productId, unit, factor } of rows) {
    byProduct.set(productId, [
      ...(byProduct.get(productId) ?? []),
      { unit, factor },
    ]);
  }
  return byProduct;
}

/**
 * One product with its conversions, or undefined. `lock` keeps the row as read until the
 * transaction ends: "update" to change it, "share" to rely on its conversions.
 */
export async function readProduct(
  db: Db | Tx,
  id: string,
  lock?: "update" | "share",
): Promise<Product | undefined> {
  const query = db.select(product).from(products).where(eq(products.id, id));
  const [found] = await (lock ? query.for(lock) : query);
  if (!found) return undefined;
  const conversions = await conversionsOf(db, [id]);
  return { ...found, conversions: conversions.get(id) ?? [] };
}

/** Refuses conversions with a unit twice or named after the base unit: 400. */
function refuseBadConversions(...args: Parameters<typeof checkConversions>) {
  const fields = checkConversions(...args);
  if (Object.keys(fields).length > 0) {
    throw new HttpError(400, "invalid_input", fields);
  }
}

export const productRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.listProducts),
    handler: async ({ query }): Promise<ProductPage> => {
      const matching = and(
        query.q ? contains(products.name, query.q) : undefined,
        query.category ? eq(products.category, query.category) : undefined,
        query.storeroomId
          ? eq(products.defaultStoreroomId, query.storeroomId)
          : undefined,
        withStatus(products.active, query.status),
      );
      const { limit, offset } = pageWindow(query);
      const [rows, [counted]] = await Promise.all([
        db
          .select(product)
          .from(products)
          .where(matching)
          .orderBy(spanishOrder(products.name), products.id)
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(products).where(matching),
      ]);
      const conversions = await conversionsOf(
        db,
        rows.map((p) => p.id),
      );
      return {
        items: rows.map((p) => ({
          ...p,
          conversions: conversions.get(p.id) ?? [],
        })),
        total: counted?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  });

  app.route({
    ...routeFor(endpoints.getProduct),
    handler: async ({ params }) => {
      const found = await readProduct(db, params.id);
      if (!found) throw notFound();
      return found;
    },
  });

  app.route({
    ...routeFor(endpoints.createProduct),
    handler: async (request, reply) => {
      const { conversions, ...fields } = request.body;
      refuseBadConversions(fields.baseUnit, conversions);
      const created = await audited(db, auditContext(request), async (tx) => {
        const [row] = await tx
          .insert(products)
          .values(fields)
          .returning({ id: products.id });
        const id = row!.id;
        if (conversions.length > 0) {
          await tx
            .insert(unitConversions)
            .values(conversions.map((c) => ({ productId: id, ...c })));
        }
        const after = (await readProduct(tx, id))!;
        return {
          result: after,
          changes: [
            {
              action: "create",
              entityType: "product",
              entityId: id,
              before: null,
              after,
            },
          ],
        };
      });
      return reply.code(201).send(created);
    },
  });

  app.route({
    ...routeFor(endpoints.updateProduct),
    handler: async (request) => {
      const { id } = request.params;
      const { conversions, ...fields } = request.body;
      return audited(db, auditContext(request), async (tx) => {
        const before = await readProduct(tx, id, "update");
        if (!before) throw notFound();

        if (conversions) {
          refuseBadConversions(before.baseUnit, conversions);
          // Every supplier product's pack must still convert, active or not.
          const packs = await tx
            .selectDistinct({
              quantity: supplierProducts.packQuantity,
              unit: supplierProducts.packUnit,
            })
            .from(supplierProducts)
            .where(eq(supplierProducts.productId, id));
          const broken = packsBroken({ ...before, conversions }, packs);
          if (Object.keys(broken).length > 0) {
            throw new HttpError(409, "conflict", broken);
          }
          // Replaced as a list: nothing refers to a conversion's own row.
          await tx
            .delete(unitConversions)
            .where(eq(unitConversions.productId, id));
          if (conversions.length > 0) {
            await tx
              .insert(unitConversions)
              .values(conversions.map((c) => ({ productId: id, ...c })));
          }
        }
        if (Object.keys(fields).length > 0) {
          await tx.update(products).set(fields).where(eq(products.id, id));
        }

        const after = (await readProduct(tx, id))!;
        return {
          result: after,
          changes: [
            {
              action: "update",
              entityType: "product",
              entityId: id,
              before,
              after,
            },
          ],
        };
      });
    },
  });
};
