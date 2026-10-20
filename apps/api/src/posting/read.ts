import {
  canonicalQuantity,
  type DocumentPosting,
  type PostedLine,
} from "@kitchen-ops/shared";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "../audit/audited";
import type { Db } from "../db/client";
import {
  documentLines,
  documents,
  movements,
  products,
  storerooms,
  users,
} from "../db/schema";

// A posted document as its page shows it (#119): each stored line as posted, with the
// movements it made, and its reversal's, if it's reversed (decision 0034).

type Reader = Db | Tx;

/** A document's stored lines in order, each with its movements in the order they were posted. */
async function postedLines(
  db: Reader,
  documentId: string,
): Promise<PostedLine[]> {
  const lines = await db
    .select({
      id: documentLines.id,
      position: documentLines.position,
      productId: products.id,
      productName: products.name,
      baseUnit: products.baseUnit,
      quantity: documentLines.quantity,
      unit: documentLines.unit,
      unitPrice: documentLines.unitPrice,
      discountPercent: documentLines.discountPercent,
      vatRate: documentLines.vatRate,
      storeroomId: storerooms.id,
      storeroomName: storerooms.name,
    })
    .from(documentLines)
    .innerJoin(products, eq(products.id, documentLines.productId))
    .leftJoin(storerooms, eq(storerooms.id, documentLines.storeroomId))
    .where(eq(documentLines.documentId, documentId))
    .orderBy(asc(documentLines.position));
  const made =
    lines.length === 0
      ? []
      : await db
          .select({
            id: movements.id,
            documentLineId: movements.documentLineId,
            storeroomId: storerooms.id,
            storeroomName: storerooms.name,
            quantity: movements.quantity,
            unitCost: movements.unitCost,
            kind: movements.kind,
            reverses: movements.reverses,
            corrects: movements.corrects,
          })
          .from(movements)
          .innerJoin(storerooms, eq(storerooms.id, movements.storeroomId))
          .where(
            inArray(
              movements.documentLineId,
              lines.map((l) => l.id),
            ),
          )
          .orderBy(asc(movements.sequence));
  return lines.map((line) => ({
    position: line.position,
    product: {
      id: line.productId,
      name: line.productName,
      baseUnit: line.baseUnit,
    },
    quantity: canonicalQuantity(line.quantity),
    unit: line.unit,
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent,
    vatRate: line.vatRate,
    storeroom:
      line.storeroomId && line.storeroomName
        ? { id: line.storeroomId, name: line.storeroomName }
        : null,
    movements: made
      .filter((m) => m.documentLineId === line.id)
      .map((m) => ({
        id: m.id,
        storeroom: { id: m.storeroomId, name: m.storeroomName },
        quantity: m.quantity,
        unitCost: m.unitCost,
        kind: m.kind,
        reverses: m.reverses,
        corrects: m.corrects,
      })),
  }));
}

/**
 * A posted document's lines and movements, and its reversal's: undefined if there's no such
 * document (a reversal is none: it's shown with what it reverses), null if it isn't posted.
 */
export async function readPosting(
  db: Reader,
  documentId: string,
): Promise<DocumentPosting | null | undefined> {
  const [document] = await db
    .select({ status: documents.status })
    .from(documents)
    .where(and(eq(documents.id, documentId), isNull(documents.reverses)));
  if (!document) return undefined;
  if (document.status !== "posted") return null;

  const [reversal] = await db
    .select({
      id: documents.id,
      date: documents.date,
      userId: users.id,
      userName: users.name,
    })
    .from(documents)
    .innerJoin(users, eq(users.id, documents.uploadedBy))
    .where(eq(documents.reverses, documentId));
  return {
    lines: await postedLines(db, documentId),
    reversal: reversal
      ? {
          id: reversal.id,
          // A reversal is posted, so it has its date (a check constraint).
          date: reversal.date!,
          reversedBy: { id: reversal.userId, name: reversal.userName },
          lines: await postedLines(db, reversal.id),
        }
      : null,
  };
}
