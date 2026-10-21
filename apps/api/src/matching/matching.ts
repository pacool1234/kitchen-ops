import {
  NEW_SUPPLIER_DOCUMENTS,
  type BaseUnit,
  type DocumentMatching,
  type ReviewReason,
} from "@kitchen-ops/shared";
import { and, count, desc, eq, isNull, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../audit/audited";
import { readSupplierProduct } from "../catalogue/supplier-products";
import type { Db } from "../db/client";
import {
  documents,
  lineSuggestions,
  products,
  suggestionCalls,
  supplierProducts,
  suppliers,
} from "../db/schema";
import { currentDraft } from "../documents/review";
import { lineKey, matchLine, type Offer } from "./match";

// A document's matching as it stands (#117, decision 0035): worked out each time from its
// supplier, its draft as it stands (corrected in review, #118, or as read) and the catalogue,
// never stored, so a supplier chosen, a line corrected or a line remembered shows at once. A line nothing matches shows the product a model
// suggested when the document was read, if any (decision 0036): that one is stored.

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

/**
 * The products a model suggested for the document's lines (decision 0036), by each line's key:
 * the latest call's answer for a line, and only an active product.
 */
async function suggestionsOf(db: Reader, documentId: string) {
  const rows = await db
    .select({
      supplierCode: lineSuggestions.supplierCode,
      description: lineSuggestions.description,
      id: products.id,
      name: products.name,
      baseUnit: products.baseUnit,
      active: products.active,
    })
    .from(lineSuggestions)
    .innerJoin(suggestionCalls, eq(suggestionCalls.id, lineSuggestions.callId))
    .leftJoin(products, eq(products.id, lineSuggestions.productId))
    .where(eq(suggestionCalls.documentId, documentId))
    .orderBy(desc(suggestionCalls.createdAt), desc(suggestionCalls.id));
  const byLine = new Map<
    string,
    { id: string; name: string; baseUnit: BaseUnit } | null
  >();
  for (const {
    supplierCode,
    description,
    id,
    name,
    baseUnit,
    active,
  } of rows) {
    const key = lineKey({ supplierCode, description });
    if (byLine.has(key)) continue;
    byLine.set(
      key,
      id !== null && name !== null && baseUnit !== null && active
        ? { id, name, baseUnit }
        : null,
    );
  }
  return {
    get: (key: string) => byLine.get(key) ?? null,
  };
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
      corrected: documents.corrected,
      checkFailures: documents.checkFailures,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.reverses)));
  if (!document) return undefined;
  const draft = currentDraft(document);

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
  const suggested = await suggestionsOf(db, documentId);

  const lines = await Promise.all(
    (draft?.lines ?? []).map(
      async (line, i): Promise<DocumentMatching["lines"][number]> => {
        const found = matchLine(line, offers);
        if (found) {
          return {
            line: i + 1,
            match: {
              by: found.by,
              supplierProduct: (await readSupplierProduct(db, found.offerId))!,
            },
            billing: null,
          };
        }
        const product = suggested.get(lineKey(line));
        return {
          line: i + 1,
          match: product ? { by: "suggestion", product } : null,
          billing: null,
        };
      },
    ),
  );

  const reasons: [ReviewReason, boolean][] = [
    ["no_draft", draft === null],
    ["failed_checks", (document.checkFailures ?? []).length > 0],
    ["no_supplier", !supplier],
    ["new_supplier", newSupplier],
    // A suggestion waits for a person to confirm it.
    [
      "unmapped_lines",
      lines.some((l) => l.match === null || l.match.by === "suggestion"),
    ],
  ];
  return {
    supplier: supplier ?? null,
    difference: null,
    newSupplier,
    lines,
    reviewReasons: reasons.filter(([, applies]) => applies).map(([r]) => r),
  };
}
