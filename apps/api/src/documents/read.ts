import {
  seesReadingCost,
  type Document,
  type DocumentSummary,
  type Role,
} from "@kitchen-ops/shared";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client";
import {
  documentFiles,
  documents,
  extractionAttempts,
  suggestionCalls,
  suppliers,
  users,
} from "../db/schema";
import { withoutMessages } from "../extraction/checks";
import type { Storage } from "../storage/storage";

// Documents as the API answers them (#102, #106): a summary for the list, and one document with
// its files, its draft and the checks it failed. A reversed one names its reversal (#119); a
// corrected copy of a reversed one is shown with the files of the document first uploaded.

/** How long a link to a file works. */
export const LINK_SECONDS = 5 * 60;

const reversal = alias(documents, "reversal");

const summary = {
  id: documents.id,
  status: documents.status,
  failureReason: documents.failureReason,
  type: documents.type,
  supplierId: suppliers.id,
  supplierName: suppliers.name,
  number: documents.number,
  date: documents.date,
  uploadedById: users.id,
  uploadedByName: users.name,
  createdAt: documents.createdAt,
  copyOf: documents.copyOf,
  reversalId: reversal.id,
  reversalDate: reversal.date,
  fileCount: sql<number>`(select count(*)::int from ${documentFiles} where ${documentFiles.documentId} = ${documents.id})`,
};

/** Documents with their supplier's and uploader's names, and their reversal if they have one. */
export const withNames = (db: Db) =>
  db
    .select(summary)
    .from(documents)
    .innerJoin(users, eq(users.id, documents.uploadedBy))
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .leftJoin(reversal, eq(reversal.reverses, documents.id));

type SummaryRow = Awaited<ReturnType<typeof withNames>>[number];

/** A supplier document's type, once read. A stock document (#149) has no summary here. */
function supplierType(type: SummaryRow["type"]): DocumentSummary["type"] {
  if (type === null || type === "delivery-note" || type === "invoice") {
    return type;
  }
  throw new Error(`a ${type} is not a supplier's document`);
}

/**
 * The document whose files each of these has: itself, or, for a corrected copy, the one first
 * uploaded, however many copies back (a copy's files are its original's, decision 0038).
 */
async function fileOwners(
  db: Db,
  rows: readonly { id: string; copyOf: string | null }[],
): Promise<Map<string, string>> {
  const owners = new Map(rows.map((r) => [r.id, r.copyOf ?? r.id]));
  let pending = rows.filter((r) => r.copyOf !== null).map((r) => r.id);
  while (pending.length > 0) {
    const cursors = [...new Set(pending.map((id) => owners.get(id)!))];
    const up = await db
      .select({ id: documents.id, copyOf: documents.copyOf })
      .from(documents)
      .where(inArray(documents.id, cursors));
    pending = pending.filter((id) => {
      const next = up.find((u) => u.id === owners.get(id))?.copyOf ?? null;
      if (next !== null) owners.set(id, next);
      return next !== null;
    });
  }
  return owners;
}

/** Summaries, a corrected copy counted with its original's files. */
export async function toSummaries(
  db: Db,
  rows: readonly SummaryRow[],
): Promise<DocumentSummary[]> {
  const copies = rows.filter((r) => r.copyOf !== null);
  const owners = await fileOwners(db, copies);
  const counts =
    copies.length === 0
      ? []
      : await db
          .select({ documentId: documentFiles.documentId, files: count() })
          .from(documentFiles)
          .where(inArray(documentFiles.documentId, [...owners.values()]))
          .groupBy(documentFiles.documentId);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    failureReason: row.failureReason,
    type: supplierType(row.type),
    supplier:
      row.supplierId && row.supplierName
        ? { id: row.supplierId, name: row.supplierName }
        : null,
    number: row.number,
    date: row.date,
    fileCount:
      row.copyOf === null
        ? row.fileCount
        : (counts.find((c) => c.documentId === owners.get(row.id))?.files ?? 0),
    uploadedBy: { id: row.uploadedById, name: row.uploadedByName },
    uploadedAt: row.createdAt.toISOString(),
    reversal:
      row.reversalId && row.reversalDate
        ? { id: row.reversalId, date: row.reversalDate }
        : null,
  }));
}

/**
 * One document with its files in order, each with a fresh link; its draft and the checks it
 * failed, by name and field; and, for the owner, what reading it cost (#106).
 */
export async function readDocument(
  db: Db,
  storage: Storage,
  id: string,
  role: Role,
): Promise<Document | undefined> {
  // A reversal has no files: it's shown with the document it reverses (#119), not on its own.
  const [row] = await withNames(db).where(
    and(eq(documents.id, id), isNull(documents.reverses)),
  );
  if (!row) return undefined;
  const filesOf = (await fileOwners(db, [row])).get(id)!;
  const [[read], files, [reading], [suggesting], [copy], [summarised]] =
    await Promise.all([
      db
        .select({
          draft: documents.draft,
          corrected: documents.corrected,
          checkFailures: documents.checkFailures,
        })
        .from(documents)
        .where(eq(documents.id, id)),
      db
        .select()
        .from(documentFiles)
        .where(eq(documentFiles.documentId, filesOf))
        .orderBy(asc(documentFiles.position)),
      // What it cost: reading it, every try, and asking for its lines' products (decision 0036).
      db
        .select({
          costMicroUsd: sql<number>`coalesce(sum(${extractionAttempts.costMicroUsd}), 0)::int`,
        })
        .from(extractionAttempts)
        .where(eq(extractionAttempts.documentId, id)),
      db
        .select({
          costMicroUsd: sql<number>`coalesce(sum(${suggestionCalls.costMicroUsd}), 0)::int`,
        })
        .from(suggestionCalls)
        .where(eq(suggestionCalls.documentId, id)),
      db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.copyOf, id)),
      toSummaries(db, [row]),
    ]);
  return {
    ...summarised!,
    draft: read?.draft ?? null,
    corrected: read?.corrected ?? null,
    checkFailures: withoutMessages(read?.checkFailures ?? []),
    ...(seesReadingCost(role)
      ? {
          costMicroUsd:
            (reading?.costMicroUsd ?? 0) + (suggesting?.costMicroUsd ?? 0),
        }
      : {}),
    copyOf: row.copyOf,
    copy: copy?.id ?? null,
    files: await Promise.all(
      files.map(async (f) => {
        const link = await storage.signedUrl(f.storageKey, LINK_SECONDS);
        return {
          id: f.id,
          position: f.position,
          kind: f.kind,
          contentType: f.contentType,
          sizeBytes: f.sizeBytes,
          url: link.url,
          urlExpiresAt: link.expiresAt,
        };
      }),
    ),
  };
}
