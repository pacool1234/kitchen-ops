import {
  canonicalQuantity,
  type DocumentPosting,
  type PostedLine,
} from "@kitchen-ops/shared";
import { and, asc, eq, inArray, isNull, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
// movements it made, and its reversal's, if it's reversed (decision 0034). An invoice's line
// says the delivery-note line it billed; a delivery note's, the invoices that bill it (#120).

type Reader = Db | Tx;

const billed = alias(documentLines, "billed");
const billedNote = alias(documents, "billed_note");
const invoice = alias(documents, "invoice");
const invoiceReversal = alias(documents, "invoice_reversal");

/** Each billed delivery-note line's position and delivery note, by its ID. */
async function billedLines(db: Reader, lineIds: readonly string[]) {
  const rows =
    lineIds.length === 0
      ? []
      : await db
          .select({
            id: billed.id,
            position: billed.position,
            noteId: billedNote.id,
            number: billedNote.number,
          })
          .from(billed)
          .innerJoin(billedNote, eq(billedNote.id, billed.documentId))
          .where(inArray(billed.id, [...lineIds]));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        deliveryNote: { id: r.noteId, number: r.number },
        position: r.position,
      },
    ]),
  );
}

/**
 * The invoices that stand (posted, neither a reversal nor reversed) and bill each of these
 * delivery-note lines, by the line's ID, in the order they were posted: a posted document never
 * changes, so its `updated_at` is when it was posted.
 */
async function billingInvoices(db: Reader, lineIds: readonly string[]) {
  const rows =
    lineIds.length === 0
      ? []
      : await db
          .select({
            lineId: documentLines.billsLineId,
            id: invoice.id,
            number: invoice.number,
          })
          .from(documentLines)
          .innerJoin(invoice, eq(invoice.id, documentLines.documentId))
          .where(
            and(
              inArray(documentLines.billsLineId, [...lineIds]),
              eq(invoice.status, "posted"),
              isNull(invoice.reverses),
              notExists(
                db
                  .select({ id: invoiceReversal.id })
                  .from(invoiceReversal)
                  .where(eq(invoiceReversal.reverses, invoice.id)),
              ),
            ),
          )
          .orderBy(asc(invoice.updatedAt), asc(invoice.id));
  const by = new Map<string, { id: string; number: string | null }[]>();
  for (const { lineId, id, number } of rows) {
    by.set(lineId!, [...(by.get(lineId!) ?? []), { id, number }]);
  }
  return by;
}

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
      billsLineId: documentLines.billsLineId,
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
  const [bills, billedBy] = await Promise.all([
    billedLines(
      db,
      lines.flatMap((l) => l.billsLineId ?? []),
    ),
    billingInvoices(
      db,
      lines.map((l) => l.id),
    ),
  ]);
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
    bills: (line.billsLineId && bills.get(line.billsLineId)) || null,
    billedBy: billedBy.get(line.id) ?? [],
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
