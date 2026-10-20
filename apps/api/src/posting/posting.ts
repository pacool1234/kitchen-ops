import { randomUUIDv7 } from "node:crypto";
import * as ledger from "@kitchen-ops/ledger";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { audited, type AuditContext, type Tx } from "../audit/audited";
import type { Db } from "../db/client";
import { documentLines, documents, movements } from "../db/schema";
import { conversionsOf, movementToRow, movementsOf } from "./stored";

// Posting a reviewed document into stored movements, and reversing a posted one (#116, decision
// 0034), through packages/ledger. Each runs in one audited transaction, after taking the
// posting lock, so postings happen one at a time and either everything is written or nothing.
// The endpoints that call these come with the screens (#119, #120).

/** One line as reviewed: what the ledger posts, without the ID it's given when it's stored. */
export interface ReviewedLine {
  readonly productId: string;
  /** In `unit`, as printed: "1.5" boxes. */
  readonly quantity: string;
  readonly unit: string;
  /** Per purchase unit, before discount, excluding VAT. */
  readonly unitPrice: ledger.UnitCost;
  readonly discountPercent?: string;
  readonly vatRate?: string;
  /** Where it's received, if not the document's storeroom (decision 0033). */
  readonly storeroomId?: string;
  /** For an invoice line: the posted delivery-note line it bills (decision 0032). */
  readonly billsLineId?: string;
  /** A flagged adjustment: it may take stock below zero (invariant 6). */
  readonly adjustment?: true;
}

/** A document as reviewed, ready to post: its header as corrected, and its lines. */
export interface ReviewedDocument {
  readonly type: "delivery-note" | "invoice";
  readonly supplierId: string;
  readonly number: string | null;
  /** The issue date, YYYY-MM-DD. */
  readonly date: string;
  /** Where its lines are received unless they name their own. */
  readonly storeroomId: string;
  readonly lines: readonly ReviewedLine[];
}

/** Why a line, or the whole document, can't be posted: the ledger's own words. */
export interface LineError {
  /** The line's position, from 1; none when it's about the whole document. */
  readonly line?: number;
  readonly message: string;
}

export type PostingResult =
  | {
      readonly ok: true;
      /** The posted document: the one given, or the reversal. */
      readonly documentId: string;
      readonly movements: readonly ledger.Movement[];
    }
  | {
      readonly ok: false;
      readonly reason:
        | "not_found"
        | "not_ready"
        | "not_posted"
        | "is_reversal"
        | "already_reversed";
    }
  | {
      readonly ok: false;
      readonly reason: "lines";
      readonly errors: readonly LineError[];
    };

/**
 * The posting lock: a transaction-level advisory lock, held until commit or rollback. A number
 * nothing else in the app uses.
 */
const POSTING_LOCK = 116_034;

async function takePostingLock(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(${POSTING_LOCK})`);
}

/** Nothing written, and nothing to audit. */
function refused(reason: Exclude<PostingResult, { ok: true }>["reason"]) {
  return { result: { ok: false, reason } as PostingResult, changes: [] };
}

/** The ledger's errors, each naming its line by position. */
function lineErrors(
  errors: readonly ledger.PostingError[],
  lineIds: readonly string[],
) {
  return {
    result: {
      ok: false,
      reason: "lines",
      errors: errors.map(({ lineId, message }) => {
        const index = lineId === undefined ? -1 : lineIds.indexOf(lineId);
        return index === -1 ? { message } : { line: index + 1, message };
      }),
    } as PostingResult,
    changes: [],
  };
}

/** A line as the ledger takes it, under its ID. */
function ledgerLine(id: string, line: ReviewedLine): ledger.InvoiceLine {
  return {
    id,
    productId: line.productId,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    ...(line.discountPercent === undefined
      ? {}
      : { discountPercent: line.discountPercent }),
    ...(line.vatRate === undefined ? {} : { vatRate: line.vatRate }),
    ...(line.storeroomId === undefined
      ? {}
      : { storeroomId: line.storeroomId }),
    ...(line.billsLineId === undefined
      ? {}
      : { deliveryNoteLineId: line.billsLineId }),
    ...(line.adjustment === true ? { adjustment: true as const } : {}),
  };
}

/**
 * A ledger line as a row. `storeroomId` is where it was received; none for a line that bills a
 * delivery-note line, whose goods stay where that one received them.
 */
function lineRow(
  documentId: string,
  position: number,
  line: ledger.InvoiceLine,
  storeroomId: string | null,
): typeof documentLines.$inferInsert {
  return {
    id: line.id,
    documentId,
    position,
    productId: line.productId,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: ledger.formatUnitCost(line.unitPrice),
    discountPercent: line.discountPercent ?? null,
    vatRate: line.vatRate ?? null,
    storeroomId,
    billsLineId: line.deliveryNoteLineId ?? null,
    adjustment: line.adjustment === true,
  };
}

/** A stored line as the ledger's. */
function lineFromRow(
  row: typeof documentLines.$inferSelect,
): ledger.InvoiceLine {
  return {
    id: row.id,
    productId: row.productId,
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: ledger.parseUnitCost(row.unitPrice),
    ...(row.discountPercent === null
      ? {}
      : { discountPercent: row.discountPercent }),
    ...(row.vatRate === null ? {} : { vatRate: row.vatRate }),
    ...(row.storeroomId === null ? {} : { storeroomId: row.storeroomId }),
    ...(row.billsLineId === null
      ? {}
      : { deliveryNoteLineId: row.billsLineId }),
    ...(row.adjustment ? { adjustment: true as const } : {}),
  };
}

/**
 * Posts a document that is ready for review: its lines and movements are stored, and it becomes
 * `posted` with its reviewed header (invariant 4: all of it, or nothing). Movements are checked
 * against everything posted before, under the posting lock. An invoice line may only bill a
 * line of a posted delivery note.
 */
export async function postDocument(
  db: Db,
  context: AuditContext,
  documentId: string,
  reviewed: ReviewedDocument,
): Promise<PostingResult> {
  return audited(db, context, async (tx) => {
    await takePostingLock(tx);
    const [row] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));
    if (!row) return refused("not_found");
    if (row.status !== "ready_for_review") return refused("not_ready");

    const lineIds = reviewed.lines.map(() => randomUUIDv7());
    const lines = reviewed.lines.map((l, i) => ledgerLine(lineIds[i]!, l));

    // The lines an invoice bills: their products' movements are needed too, and each must be a
    // posted delivery note's.
    const billedIds = reviewed.lines.flatMap((l) =>
      l.billsLineId === undefined ? [] : [l.billsLineId],
    );
    const billed =
      billedIds.length === 0
        ? []
        : await tx
            .select({
              id: documentLines.id,
              productId: documentLines.productId,
            })
            .from(documentLines)
            .innerJoin(documents, eq(documents.id, documentLines.documentId))
            .where(
              and(
                inArray(documentLines.id, billedIds),
                eq(documents.type, "delivery-note"),
                isNull(documents.reverses),
              ),
            );
    const notBillable = reviewed.lines.flatMap((l, i) =>
      l.billsLineId === undefined || billed.some((b) => b.id === l.billsLineId)
        ? []
        : [
            {
              lineId: lineIds[i]!,
              message: `line ${l.billsLineId} is not a posted delivery note's line`,
            },
          ],
    );
    if (notBillable.length > 0) return lineErrors(notBillable, lineIds);

    const productIds = [
      ...new Set([
        ...reviewed.lines.map((l) => l.productId),
        ...billed.map((b) => b.productId),
      ]),
    ];
    const [existing, conversions] = await Promise.all([
      movementsOf(tx, productIds),
      conversionsOf(tx, productIds),
    ]);
    const header = {
      id: documentId,
      date: reviewed.date,
      ...(reviewed.number === null ? {} : { number: reviewed.number }),
      status: "review" as const,
      storeroomId: reviewed.storeroomId,
      supplierId: reviewed.supplierId,
      lines,
    };
    const result = ledger.postDocument(
      reviewed.type === "invoice"
        ? { ...header, type: "invoice" }
        : { ...header, type: "delivery-note" },
      { movements: existing, conversions, newId: randomUUIDv7 },
    );
    if (!result.ok) return lineErrors(result.errors, lineIds);

    await tx
      .insert(documentLines)
      .values(
        lines.map((line, i) =>
          lineRow(
            documentId,
            i + 1,
            line,
            line.deliveryNoteLineId === undefined
              ? (line.storeroomId ?? reviewed.storeroomId)
              : null,
          ),
        ),
      );
    if (result.movements.length > 0) {
      await tx.insert(movements).values(result.movements.map(movementToRow));
    }
    const after = {
      status: "posted" as const,
      type: reviewed.type,
      supplierId: reviewed.supplierId,
      number: reviewed.number,
      date: reviewed.date,
    };
    await tx.update(documents).set(after).where(eq(documents.id, documentId));

    return {
      result: { ok: true, documentId, movements: result.movements },
      changes: [
        {
          action: "update",
          entityType: "document",
          entityId: documentId,
          documentId,
          before: {
            status: row.status,
            type: row.type,
            supplierId: row.supplierId,
            number: row.number,
            date: row.date,
          },
          after,
        },
      ],
    };
  });
}

/**
 * Reverses a posted document (spec section 6: the owner's; the endpoint checks it): a new posted
 * document reversing it, with copies of its lines and the ledger's reversing movements. The
 * posted document itself is never changed (invariant 7). All of it, or nothing.
 */
export async function reverseDocument(
  db: Db,
  context: AuditContext,
  documentId: string,
  { date }: { date: string },
): Promise<PostingResult> {
  return audited(db, context, async (tx) => {
    await takePostingLock(tx);
    const [row] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));
    if (!row) return refused("not_found");
    if (row.reverses !== null) return refused("is_reversal");
    if (
      row.status !== "posted" ||
      row.type === null ||
      row.supplierId === null ||
      row.date === null
    ) {
      return refused("not_posted");
    }
    const [earlier] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.reverses, documentId));
    if (earlier) return refused("already_reversed");

    const lineRows = await tx
      .select()
      .from(documentLines)
      .where(eq(documentLines.documentId, documentId))
      .orderBy(asc(documentLines.position));
    const lines = lineRows.map(lineFromRow);
    const existing = await movementsOf(tx, [
      ...new Set(lines.map((l) => l.productId)),
    ]);
    const header = {
      id: documentId,
      date: row.date,
      ...(row.number === null ? {} : { number: row.number }),
      status: "posted" as const,
      // Unused when reversing: each received line keeps the storeroom it went to, and a
      // reversal takes the goods out of the storerooms their movements name.
      storeroomId: lines.find((l) => l.storeroomId)?.storeroomId ?? "",
      supplierId: row.supplierId,
      lines,
    };
    const reversalId = randomUUIDv7();
    const result = ledger.reverseDocument(
      row.type === "invoice"
        ? { ...header, type: "invoice" }
        : { ...header, type: "delivery-note" },
      existing,
      { id: reversalId, date, newId: randomUUIDv7 },
    );
    if (!result.ok) {
      return lineErrors(
        result.errors,
        lines.map((l) => l.id),
      );
    }

    const created = {
      status: "posted" as const,
      type: row.type,
      supplierId: row.supplierId,
      number: row.number,
      date,
      reverses: documentId,
    };
    await tx
      .insert(documents)
      .values({ id: reversalId, ...created, uploadedBy: context.userId });
    const copies = result.document.lines as readonly ledger.InvoiceLine[];
    await tx
      .insert(documentLines)
      .values(
        copies.map((line, i) =>
          lineRow(reversalId, i + 1, line, line.storeroomId ?? null),
        ),
      );
    if (result.movements.length > 0) {
      await tx.insert(movements).values(result.movements.map(movementToRow));
    }

    return {
      result: {
        ok: true,
        documentId: reversalId,
        movements: result.movements,
      },
      changes: [
        {
          action: "create",
          entityType: "document",
          entityId: reversalId,
          documentId: reversalId,
          before: null,
          after: created,
        },
      ],
    };
  });
}
