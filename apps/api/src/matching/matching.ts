import {
  NEW_SUPPLIER_DOCUMENTS,
  type DocumentMatching,
  type ReviewReason,
} from "@kitchen-ops/shared";
import { and, count, eq, isNull, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../audit/audited";
import { readSupplierProduct } from "../catalogue/supplier-products";
import type { Db } from "../db/client";
import { documents, products, supplierProducts, suppliers } from "../db/schema";
import { matchLine, type Offer } from "./match";

// A document's matching as it stands (#117, decision 0035): worked out each time from its
// supplier, its draft and the catalogue, never stored, so a supplier chosen or a line
// remembered in review shows at once.

type Reader = Db | Tx;

/** The supplier's supplier products, as matching compares them. */
export async function offersOf(
  db: Reader,
  supplierId: string,
): Promise<Offer[]> {
  const rows = await db
    .select({
      id: supplierProducts.id,
      code: supplierProducts.code,
      description: supplierProducts.description,
      active: supplierProducts.active,
      productActive: products.active,
    })
    .from(supplierProducts)
    .innerJoin(products, eq(products.id, supplierProducts.productId))
    .where(eq(supplierProducts.supplierId, supplierId));
  return rows.map(({ active, productActive, ...offer }) => ({
    ...offer,
    usable: active && productActive,
  }));
}

const reversal = alias(documents, "reversal");

/** Posted documents of the supplier that stand: not reversals, and not reversed. */
async function postedCount(db: Reader, supplierId: string): Promise<number> {
  const [counted] = await db
    .select({ total: count() })
    .from(documents)
    .where(
      and(
        eq(documents.supplierId, supplierId),
        eq(documents.status, "posted"),
        isNull(documents.reverses),
        notExists(
          db
            .select({ id: reversal.id })
            .from(reversal)
            .where(eq(reversal.reverses, documents.id)),
        ),
      ),
    );
  return counted?.total ?? 0;
}

/** The document's matching, or undefined if there's no such document (a reversal is none). */
export async function readMatching(
  db: Reader,
  documentId: string,
): Promise<DocumentMatching | undefined> {
  const [document] = await db
    .select({
      supplierId: documents.supplierId,
      draft: documents.draft,
      checkFailures: documents.checkFailures,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.reverses)));
  if (!document) return undefined;

  const [supplier] = document.supplierId
    ? await db
        .select({
          id: suppliers.id,
          name: suppliers.name,
          taxId: suppliers.taxId,
        })
        .from(suppliers)
        .where(eq(suppliers.id, document.supplierId))
    : [];
  const [offers, posted] = supplier
    ? await Promise.all([
        offersOf(db, supplier.id),
        postedCount(db, supplier.id),
      ])
    : [[], 0];
  const newSupplier = supplier !== undefined && posted < NEW_SUPPLIER_DOCUMENTS;

  const lines = await Promise.all(
    (document.draft?.lines ?? []).map(async (line, i) => {
      const found = matchLine(line, offers);
      return {
        line: i + 1,
        match: found && {
          by: found.by,
          supplierProduct: (await readSupplierProduct(db, found.offerId))!,
        },
      };
    }),
  );

  const reasons: [ReviewReason, boolean][] = [
    ["no_draft", document.draft === null],
    ["failed_checks", (document.checkFailures ?? []).length > 0],
    ["no_supplier", !supplier],
    ["new_supplier", newSupplier],
    ["unmapped_lines", lines.some((l) => l.match === null)],
  ];
  return {
    supplier: supplier ?? null,
    newSupplier,
    lines,
    reviewReasons: reasons.filter(([, applies]) => applies).map(([r]) => r),
  };
}
