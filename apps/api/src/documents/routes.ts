import { createHash, randomUUIDv7 } from "node:crypto";
import "@fastify/multipart";
import {
  endpoints,
  seesReadingCost,
  UPLOAD_LIMITS,
  type Document,
  type DocumentPage,
  type FieldErrorCode,
  type Role,
} from "@kitchen-ops/shared";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { audited, auditContext } from "../audit/audited";
import { routeFor } from "../contract";
import type { Db } from "../db/client";
import {
  documentFiles,
  documents,
  extractionAttempts,
  suppliers,
  users,
} from "../db/schema";
import { HttpError, notFound } from "../errors";
import type { Jobs } from "../extraction/jobs";
import type { Storage } from "../storage/storage";
import { checkUpload } from "./upload";

// Supplier documents (#102): uploaded as one PDF or Facturae file or up to 10 photos, each file
// kept in object storage (decision 0029), and read back with links that last 5 minutes. A file
// already received, by its sha256, is refused, naming the document that has it. Saving one queues
// the job that reads it (#104), in the same transaction; a failed one can be queued again.

/** How long a link to a file works. */
export const LINK_SECONDS = 5 * 60;

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** The files of a multipart upload, in order, as bytes. Refusals as field errors. */
async function readFiles(request: FastifyRequest): Promise<Uint8Array[]> {
  const files: Uint8Array[] = [];
  let total = 0;
  try {
    for await (const part of request.parts()) {
      if (part.type !== "file" || part.fieldname !== UPLOAD_LIMITS.field) {
        if (part.type === "file") await part.toBuffer();
        continue;
      }
      // Cut off just past the limit: what's longer is too big, and checkUpload says so.
      const bytes = new Uint8Array(await part.toBuffer());
      total += bytes.length;
      if (total > UPLOAD_LIMITS.maxRequestBytes) {
        throw new HttpError(400, "invalid_input", { files: "too_big" });
      }
      files.push(bytes);
    }
  } catch (error) {
    if ((error as { code?: string }).code === "FST_FILES_LIMIT") {
      throw new HttpError(400, "invalid_input", { files: "too_many" });
    }
    throw error;
  }
  return files;
}

/** Each refused file, and the document that has the first of them. */
type Duplicates = { fields: Record<string, FieldErrorCode>; of?: string };

async function findDuplicates(db: Db, hashes: string[]): Promise<Duplicates> {
  const fields: Record<string, FieldErrorCode> = {};
  // The same file twice in one upload.
  hashes.forEach((hash, i) => {
    if (hashes.indexOf(hash) < i) fields[`files.${i + 1}`] = "taken";
  });
  const known = await db
    .select({
      sha256: documentFiles.sha256,
      documentId: documentFiles.documentId,
    })
    .from(documentFiles)
    .where(inArray(documentFiles.sha256, hashes));
  const owner = new Map(known.map((k) => [k.sha256, k.documentId]));
  let of: string | undefined;
  hashes.forEach((hash, i) => {
    const documentId = owner.get(hash);
    if (documentId) {
      fields[`files.${i + 1}`] = "taken";
      of ??= documentId;
    }
  });
  return { fields, ...(of ? { of } : {}) };
}

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
  fileCount: sql<number>`(select count(*)::int from ${documentFiles} where ${documentFiles.documentId} = ${documents.id})`,
};

const withNames = (db: Db) =>
  db
    .select(summary)
    .from(documents)
    .innerJoin(users, eq(users.id, documents.uploadedBy))
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId));

type SummaryRow = Awaited<ReturnType<typeof withNames>>[number];

const toSummary = (row: SummaryRow) => ({
  id: row.id,
  status: row.status,
  failureReason: row.failureReason,
  type: row.type,
  supplier:
    row.supplierId && row.supplierName
      ? { id: row.supplierId, name: row.supplierName }
      : null,
  number: row.number,
  date: row.date,
  fileCount: row.fileCount,
  uploadedBy: { id: row.uploadedById, name: row.uploadedByName },
  uploadedAt: row.createdAt.toISOString(),
});

/**
 * One document with its files in order, each with a fresh link; its draft and the checks it
 * failed, by name and field; and, for the owner, what reading it cost (#106).
 */
async function readDocument(
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
  const [[read], files, [spent]] = await Promise.all([
    db
      .select({
        draft: documents.draft,
        checkFailures: documents.checkFailures,
      })
      .from(documents)
      .where(eq(documents.id, id)),
    db
      .select()
      .from(documentFiles)
      .where(eq(documentFiles.documentId, id))
      .orderBy(asc(documentFiles.position)),
    db
      .select({
        costMicroUsd: sql<number>`coalesce(sum(${extractionAttempts.costMicroUsd}), 0)::int`,
      })
      .from(extractionAttempts)
      .where(eq(extractionAttempts.documentId, id)),
  ]);
  return {
    ...toSummary(row),
    draft: read?.draft ?? null,
    // Each check's message stays in the database: it may quote the document.
    checkFailures: (read?.checkFailures ?? []).map(({ check, path }) => ({
      check,
      path,
    })),
    ...(seesReadingCost(role)
      ? { costMicroUsd: spent?.costMicroUsd ?? 0 }
      : {}),
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

export const documentRoutes: FastifyPluginAsyncZod<{
  db: Db;
  storage: Storage | null;
  jobs: Jobs;
}> = async (app, { db, storage, jobs }) => {
  /** Storage, or 503: without it, files can be neither kept nor read. */
  const needStorage = (): Storage => {
    if (!storage) throw new HttpError(503, "storage_unavailable");
    return storage;
  };

  app.route({
    ...routeFor(endpoints.uploadDocument),
    handler: async (request, reply) => {
      const store = needStorage();
      const received = await readFiles(request);
      const checked = checkUpload(received.map((bytes) => ({ bytes })));
      if (!checked.ok) {
        throw new HttpError(400, "invalid_input", checked.fields);
      }
      const hashes = received.map(sha256);
      const duplicates = await findDuplicates(db, hashes);
      if (Object.keys(duplicates.fields).length > 0) {
        throw new HttpError(409, "conflict", duplicates.fields, duplicates.of);
      }

      // Files first, then the rows: rows never point at a file that isn't there. If saving the
      // rows fails, the files just stored are removed again.
      const id = randomUUIDv7();
      const files = checked.files.map((file, i) => ({
        ...file,
        position: i + 1,
        sha256: hashes[i]!,
        sizeBytes: received[i]!.length,
        storageKey: `documents/${id}/${i + 1}.${file.extension}`,
      }));
      const stored: string[] = [];
      try {
        for (const [i, file] of files.entries()) {
          await store.put(file.storageKey, received[i]!, file.contentType);
          stored.push(file.storageKey);
        }
        await audited(db, auditContext(request), async (tx) => {
          await tx
            .insert(documents)
            .values({ id, uploadedBy: request.user!.id });
          // Its job, in this transaction: if anything after this fails, the job goes too.
          await jobs.queueRead(tx, id);
          await tx.insert(documentFiles).values(
            files.map((f) => ({
              documentId: id,
              position: f.position,
              kind: f.kind,
              contentType: f.contentType,
              sizeBytes: f.sizeBytes,
              sha256: f.sha256,
              storageKey: f.storageKey,
            })),
          );
          return {
            result: undefined,
            changes: [
              {
                action: "create",
                entityType: "document",
                entityId: id,
                documentId: id,
                before: null,
                after: {
                  id,
                  status: "queued",
                  files: files.map((f) => ({
                    position: f.position,
                    kind: f.kind,
                    sha256: f.sha256,
                    sizeBytes: f.sizeBytes,
                  })),
                },
              },
            ],
          };
        });
      } catch (error) {
        await Promise.allSettled(stored.map((key) => store.delete(key)));
        throw error;
      }
      return reply
        .code(201)
        .send((await readDocument(db, store, id, request.user!.role))!);
    },
  });

  app.route({
    ...routeFor(endpoints.listDocuments),
    handler: async ({ query }): Promise<DocumentPage> => {
      const matching = and(
        isNull(documents.reverses),
        query.status ? eq(documents.status, query.status) : undefined,
      );
      const [rows, [counted]] = await Promise.all([
        withNames(db)
          .where(matching)
          .orderBy(desc(documents.createdAt), desc(documents.id))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        db.select({ total: count() }).from(documents).where(matching),
      ]);
      return {
        items: rows.map(toSummary),
        total: counted?.total ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    },
  });

  app.route({
    ...routeFor(endpoints.getDocument),
    handler: async ({ params, user }) => {
      const found = await readDocument(
        db,
        needStorage(),
        params.id,
        user!.role,
      );
      if (!found) throw notFound();
      return found;
    },
  });

  app.route({
    ...routeFor(endpoints.retryDocument),
    handler: async (request) => {
      const store = needStorage();
      const { id } = request.params;
      await audited(db, auditContext(request), async (tx) => {
        // Locked, so two retries at once can't both queue it.
        const [before] = await tx
          .select({
            status: documents.status,
            failureReason: documents.failureReason,
          })
          .from(documents)
          .where(eq(documents.id, id))
          .for("update");
        if (!before) throw notFound();
        if (before.status !== "failed") throw new HttpError(409, "not_failed");
        await tx
          .update(documents)
          .set({ status: "queued", failureReason: null })
          .where(eq(documents.id, id));
        await jobs.queueRead(tx, id);
        return {
          result: undefined,
          changes: [
            {
              action: "update",
              entityType: "document",
              entityId: id,
              documentId: id,
              before: {
                status: before.status,
                failureReason: before.failureReason,
              },
              after: { status: "queued", failureReason: null },
            },
          ],
        };
      });
      return (await readDocument(db, store, id, request.user!.role))!;
    },
  });
};
