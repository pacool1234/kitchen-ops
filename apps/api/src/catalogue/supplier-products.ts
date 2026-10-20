import {
  canonicalQuantity,
  endpoints,
  type NewSupplierProduct,
  type Pack,
  type SupplierProduct,
  type SupplierProductPage,
} from "@kitchen-ops/shared";
import { and, count, eq, or } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext, type Tx } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import { products, supplierProducts, suppliers } from "../db/schema";
import { HttpError, notFound } from "../errors";
import { packBaseUnits, type ConvertibleProduct } from "./conversions";
import { contains, pageWindow, spanishOrder, withStatus } from "./lists";
import { readProduct } from "./products";

// Supplier products (#88): how a supplier names and packs one of our products. The pack is a
// quantity in one of the product's units; its base units are worked out by packages/ledger from
// the product's current conversions each time it's read. Everyone signed in reads them; office
// and owner change them. Every change is audited.

/** A supplier product's row, with its supplier's and product's names. */
const offer = {
  id: supplierProducts.id,
  code: supplierProducts.code,
  description: supplierProducts.description,
  packQuantity: supplierProducts.packQuantity,
  packUnit: supplierProducts.packUnit,
  active: supplierProducts.active,
  supplierId: suppliers.id,
  supplierName: suppliers.name,
  productId: products.id,
  productName: products.name,
  baseUnit: products.baseUnit,
};

const withNames = (db: Db | Tx) =>
  db
    .select(offer)
    .from(supplierProducts)
    .innerJoin(suppliers, eq(suppliers.id, supplierProducts.supplierId))
    .innerJoin(products, eq(products.id, supplierProducts.productId));

type OfferRow = Awaited<ReturnType<typeof withNames>>[number];

/** As the API answers it, with the pack in base units from the product's conversions. */
function toSupplierProduct(
  row: OfferRow,
  product: ConvertibleProduct,
): SupplierProduct {
  const pack = {
    quantity: canonicalQuantity(row.packQuantity),
    unit: row.packUnit,
  };
  const converted = packBaseUnits(product, pack);
  if ("refused" in converted) {
    // Product updates keep every pack convertible, so this is a bug, not a refusal.
    throw new Error(
      `supplier product ${row.id}: its pack ${converted.refused}`,
    );
  }
  return {
    id: row.id,
    supplier: { id: row.supplierId, name: row.supplierName },
    code: row.code,
    description: row.description,
    product: {
      id: row.productId,
      name: row.productName,
      baseUnit: row.baseUnit,
    },
    pack,
    packBaseUnits: converted.baseUnits,
    active: row.active,
  };
}

/** What the audit log records: its own fields, its supplier and product by ID. */
const recorded = (s: SupplierProduct) => ({
  id: s.id,
  supplierId: s.supplier.id,
  code: s.code,
  description: s.description,
  productId: s.product.id,
  pack: s.pack,
  active: s.active,
});

export async function readSupplierProduct(
  db: Db | Tx,
  id: string,
  lock?: "update",
): Promise<SupplierProduct | undefined> {
  const query = withNames(db).where(eq(supplierProducts.id, id));
  // Only the supplier product's row: its supplier and product stay free to change.
  const [row] = await (lock
    ? query.for(lock, { of: supplierProducts })
    : query);
  if (!row) return undefined;
  const product = await readProduct(db, row.productId);
  return toSupplierProduct(row, product!);
}

/**
 * The product a pack is for, locked until the transaction ends so its conversions can't change
 * under the new pack. Refuses a product that doesn't exist, or a pack it can't convert: 400.
 */
async function checkPack(tx: Tx, productId: string, pack: Pack) {
  const product = await readProduct(tx, productId, "share");
  if (!product) {
    throw new HttpError(400, "invalid_input", { productId: "not_found" });
  }
  const converted = packBaseUnits(product, pack);
  if ("refused" in converted) {
    const field = converted.refused === "unknown_unit" ? "unit" : "quantity";
    throw new HttpError(400, "invalid_input", {
      [`pack.${field}`]: converted.refused,
    });
  }
}

/**
 * Adds a supplier product, its pack checked against its product, with the audit entry for it:
 * from the catalogue, or from a document's line (#117), whose ID the entry then records.
 */
export async function createSupplierProduct(
  tx: Tx,
  { pack, ...fields }: NewSupplierProduct,
  documentId?: string,
) {
  await checkPack(tx, fields.productId, pack);
  // A supplier that doesn't exist is refused by its foreign key: 400 supplierId not_found.
  const [row] = await tx
    .insert(supplierProducts)
    .values({
      ...fields,
      packQuantity: pack.quantity,
      packUnit: pack.unit,
    })
    .returning({ id: supplierProducts.id });
  const after = (await readSupplierProduct(tx, row!.id))!;
  return {
    result: after,
    changes: [
      {
        action: "create" as const,
        entityType: "supplier_product",
        entityId: after.id,
        ...(documentId ? { documentId } : {}),
        before: null,
        after: recorded(after),
      },
    ],
  };
}

export const supplierProductRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (
  app,
  { db },
) => {
  app.route({
    ...routeFor(endpoints.listSupplierProducts),
    handler: async ({ query }): Promise<SupplierProductPage> => {
      const matching = and(
        query.q
          ? or(
              contains(supplierProducts.code, query.q),
              contains(supplierProducts.description, query.q),
            )
          : undefined,
        query.supplierId
          ? eq(supplierProducts.supplierId, query.supplierId)
          : undefined,
        query.productId
          ? eq(supplierProducts.productId, query.productId)
          : undefined,
        withStatus(supplierProducts.active, query.status),
      );
      const { limit, offset } = pageWindow(query);
      const [rows, [counted]] = await Promise.all([
        withNames(db)
          .where(matching)
          .orderBy(
            spanishOrder(supplierProducts.description),
            supplierProducts.code,
            supplierProducts.id,
          )
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(supplierProducts).where(matching),
      ]);
      const productsById = new Map<string, ConvertibleProduct>();
      for (const id of new Set(rows.map((r) => r.productId))) {
        productsById.set(id, (await readProduct(db, id))!);
      }
      return {
        items: rows.map((row) =>
          toSupplierProduct(row, productsById.get(row.productId)!),
        ),
        total: counted?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  });

  app.route({
    ...routeFor(endpoints.getSupplierProduct),
    handler: async ({ params }) => {
      const found = await readSupplierProduct(db, params.id);
      if (!found) throw notFound();
      return found;
    },
  });

  app.route({
    ...routeFor(endpoints.createSupplierProduct),
    handler: async (request, reply) => {
      const created = await audited(db, auditContext(request), (tx) =>
        createSupplierProduct(tx, request.body),
      );
      return reply.code(201).send(created);
    },
  });

  app.route({
    ...routeFor(endpoints.updateSupplierProduct),
    handler: async (request) => {
      const { id } = request.params;
      const { pack, ...fields } = request.body;
      return audited(db, auditContext(request), async (tx) => {
        const before = await readSupplierProduct(tx, id, "update");
        if (!before) throw notFound();
        // Another product or another pack: the pack must convert in the product it ends with.
        if (fields.productId !== undefined || pack !== undefined) {
          await checkPack(
            tx,
            fields.productId ?? before.product.id,
            pack ?? before.pack,
          );
        }
        const set = {
          ...fields,
          ...(pack ? { packQuantity: pack.quantity, packUnit: pack.unit } : {}),
        };
        if (Object.keys(set).length > 0) {
          await tx
            .update(supplierProducts)
            .set(set)
            .where(eq(supplierProducts.id, id));
        }
        const after = (await readSupplierProduct(tx, id))!;
        return {
          result: after,
          changes: [
            {
              action: "update",
              entityType: "supplier_product",
              entityId: id,
              before: recorded(before),
              after: recorded(after),
            },
          ],
        };
      });
    },
  });
};
