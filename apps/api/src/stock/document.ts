import {
  STOCK_DOCUMENT_TYPES,
  type PostedLine,
  type PostedStockDocument,
  type StockDocumentLine,
} from "@kitchen-ops/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../audit/audited";
import type { Db } from "../db/client";
import { documents, storerooms, users } from "../db/schema";
import { readPosting } from "../posting/read";

// Waste, a transfer or a count as its page shows it (#151): what was recorded, where, why and by
// whom, each line with the movements it made, and its reversal's. Unit costs are for office and
// the owner only (spec section 6), as on the stock list (#150).

const toStoreroom = alias(storerooms, "to_storeroom");

/** A posted line as a stock document shows it: no prices, and costs only when they're seen. */
function stockLine(line: PostedLine, costs: boolean): StockDocumentLine {
  return {
    position: line.position,
    product: line.product,
    quantity: line.quantity,
    unit: line.unit,
    movements: line.movements.map((m) => ({
      id: m.id,
      storeroom: m.storeroom,
      quantity: m.quantity,
      ...(costs ? { unitCost: m.unitCost } : {}),
      kind: m.kind,
    })),
  };
}

/**
 * A stock document by its ID, with unit costs if `costs`: undefined if there's none, or it's a
 * supplier's, or a reversal (shown with what it reverses).
 */
export async function readStockDocument(
  db: Db | Tx,
  id: string,
  { costs }: { costs: boolean },
): Promise<PostedStockDocument | undefined> {
  const [row] = await db
    .select({
      type: documents.type,
      date: documents.date,
      storeroomId: storerooms.id,
      storeroomName: storerooms.name,
      toStoreroomId: toStoreroom.id,
      toStoreroomName: toStoreroom.name,
      reason: documents.wasteReason,
      note: documents.note,
      countedAt: documents.countedAt,
      userId: users.id,
      userName: users.name,
    })
    .from(documents)
    .innerJoin(storerooms, eq(storerooms.id, documents.storeroomId))
    .leftJoin(toStoreroom, eq(toStoreroom.id, documents.toStoreroomId))
    .innerJoin(users, eq(users.id, documents.uploadedBy))
    .where(
      and(
        eq(documents.id, id),
        isNull(documents.reverses),
        inArray(documents.type, [...STOCK_DOCUMENT_TYPES]),
      ),
    );
  // A stock document is posted as it's recorded, so it has its posting and its date.
  const posting = row && (await readPosting(db, id));
  if (!row || !posting) return undefined;
  return {
    id,
    // One of the stock document types: the query takes no other.
    type: row.type as PostedStockDocument["type"],
    date: row.date!,
    storeroom: { id: row.storeroomId, name: row.storeroomName },
    toStoreroom:
      row.toStoreroomId && row.toStoreroomName
        ? { id: row.toStoreroomId, name: row.toStoreroomName }
        : null,
    reason: row.reason,
    note: row.note,
    countedAt: row.countedAt?.toISOString() ?? null,
    recordedBy: { id: row.userId, name: row.userName },
    lines: posting.lines.map((line) => stockLine(line, costs)),
    reversal: posting.reversal && {
      id: posting.reversal.id,
      date: posting.reversal.date,
      reversedBy: posting.reversal.reversedBy,
      lines: posting.reversal.lines.map((line) => stockLine(line, costs)),
    },
  };
}
