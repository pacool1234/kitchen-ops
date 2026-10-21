import { createHash, randomUUIDv7 } from "node:crypto";
import * as ledger from "@kitchen-ops/ledger";
import type {
  FieldErrorCode,
  StockLine,
  WasteReason,
} from "@kitchen-ops/shared";
import { eq, inArray } from "drizzle-orm";
import { audited, type AuditContext, type Tx } from "../audit/audited";
import type { Db } from "../db/client";
import {
  documentLines,
  documents,
  movements,
  products,
  storerooms,
} from "../db/schema";
import { lineRow, takePostingLock } from "../posting/posting";
import {
  conversionsOf,
  movementToRow,
  movementsOf,
  postedBefore,
} from "../posting/stored";

// Waste, transfers and counts (#149, decision 0044): stock documents that staff record, posted
// as they're recorded, in one audited transaction under the posting lock. Each is recorded
// under an ID the client made: the same request again answers what was posted and posts
// nothing more, so a phone that never heard the answer can simply send it again (#153).

/** How far ahead of the database's clock a count's time may be: a phone's clock that runs fast. */
export const CLOCK_AHEAD_MS = 5 * 60_000;

/** What was recorded: waste from a storeroom, a transfer out of one into another, or a count. */
export type StockDocument =
  | {
      readonly type: "waste";
      readonly storeroomId: string;
      readonly reason: WasteReason;
      readonly note: string | null;
      readonly lines: readonly StockLine[];
    }
  | {
      readonly type: "transfer";
      readonly storeroomId: string;
      readonly toStoreroomId: string;
      readonly lines: readonly StockLine[];
    }
  | {
      readonly type: "count";
      readonly storeroomId: string;
      /** When it was counted, as ISO text in UTC. */
      readonly countedAt: string;
      /** What was counted: 0 is a count too. */
      readonly lines: readonly StockLine[];
    };

export type RecordResult =
  /** The movements it posted: none when the same request was posted already. */
  | { readonly ok: true; readonly movements: readonly ledger.Movement[] }
  /** The ID is another document's, or this one's recorded from another request. */
  | { readonly ok: false; readonly reason: "conflict" }
  /** A storeroom, product, unit, quantity or count's time that can't be: by field. */
  | {
      readonly ok: false;
      readonly reason: "invalid";
      readonly fields: Readonly<Record<string, FieldErrorCode>>;
    }
  /** Lines that would take stock below zero (invariant 6): by field. Never a count's. */
  | {
      readonly ok: false;
      readonly reason: "below_zero";
      readonly fields: Readonly<Record<string, FieldErrorCode>>;
    };

/** JSON with every object's keys in order: the same document always gives the same text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** What a request records, as a fingerprint: sent again, the same document gives the same one. */
export function requestSha256(document: StockDocument): string {
  return createHash("sha256").update(canonicalJson(document)).digest("hex");
}

/** Each storeroom must be one of ours, and in use; a transfer must go elsewhere. */
async function storeroomRefusals(
  tx: Tx,
  document: StockDocument,
  fields: Record<string, FieldErrorCode>,
) {
  const places: [string, string][] = [["storeroomId", document.storeroomId]];
  if (document.type === "transfer") {
    places.push(["toStoreroomId", document.toStoreroomId]);
  }
  const found = await tx
    .select({ id: storerooms.id, active: storerooms.active })
    .from(storerooms)
    .where(inArray(storerooms.id, [...new Set(places.map(([, id]) => id))]));
  for (const [field, id] of places) {
    const storeroom = found.find((s) => s.id === id);
    if (!storeroom) fields[field] = "not_found";
    else if (!storeroom.active) fields[field] = "invalid";
  }
  if (
    document.type === "transfer" &&
    document.toStoreroomId === document.storeroomId
  ) {
    fields.toStoreroomId = "invalid";
  }
}

/**
 * Records waste, a transfer or a count under `id`, and posts it: its document, lines and
 * movements, all or nothing, dated `date`. Every line is checked before the ledger posts it, so
 * what the ledger refuses is stock that would go below zero. A count is measured against the
 * movements posted by the time it was counted (decision 0043); one that's late and leaves stock
 * below zero is posted as a flagged adjustment instead.
 */
export async function recordStockDocument(
  db: Db,
  context: AuditContext,
  id: string,
  document: StockDocument,
  { date }: { date: string },
): Promise<RecordResult> {
  return audited<RecordResult>(db, context, async (tx) => {
    const postedAt = await takePostingLock(tx);
    const sha = requestSha256(document);
    const [existing] = await tx
      .select({ type: documents.type, requestSha256: documents.requestSha256 })
      .from(documents)
      .where(eq(documents.id, id));
    if (existing) {
      const same =
        existing.type === document.type && existing.requestSha256 === sha;
      return {
        result: same
          ? { ok: true, movements: [] }
          : { ok: false, reason: "conflict" },
        changes: [],
      };
    }

    const fields: Record<string, FieldErrorCode> = {};
    await storeroomRefusals(tx, document, fields);
    // A count from the future would be measured against movements posted after it was made.
    if (
      document.type === "count" &&
      Date.parse(document.countedAt) > postedAt.getTime() + CLOCK_AHEAD_MS
    ) {
      fields.countedAt = "invalid";
    }
    const productIds = [...new Set(document.lines.map((l) => l.productId))];
    const [known, conversions] = await Promise.all([
      tx
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.id, productIds)),
      conversionsOf(tx, productIds),
    ]);
    document.lines.forEach((line, i) => {
      if (!known.some((p) => p.id === line.productId)) {
        fields[`lines.${i}.productId`] = "not_found";
      } else if (
        !conversions.some(
          (c) => c.productId === line.productId && c.unit === line.unit,
        )
      ) {
        fields[`lines.${i}.unit`] = "unknown_unit";
      } else {
        try {
          ledger.toBaseUnits(line, conversions);
        } catch {
          fields[`lines.${i}.quantity`] = "not_whole_base_units";
        }
      }
    });
    if (Object.keys(fields).length > 0) {
      return { result: { ok: false, reason: "invalid", fields }, changes: [] };
    }

    const lines = document.lines.map((line): ledger.DocumentLine => ({
      id: randomUUIDv7(),
      productId: line.productId,
      quantity: line.quantity,
      unit: line.unit,
    }));
    const header = {
      id,
      date,
      status: "review" as const,
      storeroomId: document.storeroomId,
      lines,
    };
    const posted = ledger.postDocument(
      document.type === "waste"
        ? { ...header, type: "waste" }
        : document.type === "transfer"
          ? {
              ...header,
              type: "transfer",
              toStoreroomId: document.toStoreroomId,
            }
          : {
              ...header,
              type: "count",
              movementsBeforeCount: await postedBefore(
                tx,
                productIds,
                new Date(document.countedAt),
              ),
            },
      {
        movements: await movementsOf(tx, productIds),
        conversions,
        newId: randomUUIDv7,
      },
    );
    if (!posted.ok) {
      const below: Record<string, FieldErrorCode> = {};
      for (const { lineId } of posted.errors) {
        const i = lines.findIndex((l) => l.id === lineId);
        if (i !== -1) below[`lines.${i}.quantity`] = "below_zero";
      }
      return {
        result: { ok: false, reason: "below_zero", fields: below },
        changes: [],
      };
    }

    const created = {
      status: "posted" as const,
      type: document.type,
      date,
      storeroomId: document.storeroomId,
      toStoreroomId:
        document.type === "transfer" ? document.toStoreroomId : null,
      wasteReason: document.type === "waste" ? document.reason : null,
      note: document.type === "waste" ? document.note : null,
      countedAt:
        document.type === "count" ? new Date(document.countedAt) : null,
    };
    await tx.insert(documents).values({
      id,
      ...created,
      requestSha256: sha,
      uploadedBy: context.userId,
    });
    await tx
      .insert(documentLines)
      .values(
        lines.map((line, i) =>
          lineRow(
            id,
            i + 1,
            { ...line, storeroomId: document.storeroomId },
            document.storeroomId,
            { unit: line.unit, supplierProductId: null },
          ),
        ),
      );
    await tx
      .insert(movements)
      .values(posted.movements.map((m) => movementToRow(m, postedAt)));
    return {
      result: { ok: true, movements: posted.movements },
      changes: [
        {
          action: "create",
          entityType: "document",
          entityId: id,
          documentId: id,
          before: null,
          after: created,
        },
      ],
    };
  });
}
