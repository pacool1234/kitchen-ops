import {
  extractFiles,
  MAX_AGE_DAYS,
  validate,
  type CallRecord,
} from "@kitchen-ops/extract";
import {
  normalizeTaxId,
  type ExtractedDocument,
  type ExtractionFailure,
} from "@kitchen-ops/shared";
import * as Sentry from "@sentry/node";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client";
import {
  documentFiles,
  documents,
  extractionAttempts,
  suppliers,
} from "../db/schema";
import type { Storage } from "../storage/storage";
import type { FailedRead, ReadTry } from "./jobs";
import type { Reader } from "./reader";

// One try at reading a document (#104, spec section 5): its files from storage, through routing
// and the model with client routing, then the checks, with the numbers already received from
// that supplier. It ends ready for review whether the checks pass or not (M7 reviews them), or
// failed. Each try is recorded with what it cost. Logs and Sentry get IDs and reason codes only:
// never the document's contents, which the model's answers and check messages may quote.

/** Today in Madrid, as YYYY-MM-DD: what a document's date is checked against. */
export const today = (now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now);

/** Thrown to have pg-boss try again. The try, and why it failed, are recorded already. */
export class TryAgain extends Error {
  override name = "TryAgain";
  constructor(readonly reason: ExtractionFailure) {
    super(`reading the document failed: ${reason}`);
  }
}

export interface ReadContext {
  readonly db: Db;
  readonly storage: Storage;
  readonly reader: Reader;
  readonly log: FastifyBaseLogger;
  readonly now?: () => Date;
}

/** A document waiting to be read: queued, or being read by a try that never finished. */
const WAITING = ["queued", "reading"] as const;

type Outcome = (typeof extractionAttempts.$inferInsert)["outcome"];
type DocumentChanges = Partial<typeof documents.$inferInsert>;

/** What a try's model calls cost and took, for its row. */
const spent = (record: CallRecord | null) =>
  record
    ? {
        model: record.model,
        promptVersion: record.promptVersion,
        modelCalls: record.attempts,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        costMicroUsd: record.costMicroUsd,
        latencyMs: record.latencyMs,
      }
    : {};

/** Records the try and moves the document on, together. */
async function finish(
  db: Db,
  job: ReadTry,
  outcome: Outcome,
  failureReason: ExtractionFailure | null,
  record: CallRecord | null,
  changes: DocumentChanges,
) {
  await db.transaction(async (tx) => {
    await tx.insert(extractionAttempts).values({
      documentId: job.documentId,
      jobId: job.jobId,
      try: job.try,
      outcome,
      failureReason,
      ...spent(record),
    });
    await tx
      .update(documents)
      .set(changes)
      .where(
        and(eq(documents.id, job.documentId), eq(documents.status, "reading")),
      );
  });
}

/** Records a try that failed, puts the document back in the queue, and has pg-boss try again. */
async function tryAgain(
  db: Db,
  job: ReadTry,
  reason: ExtractionFailure,
  record: CallRecord | null,
): Promise<never> {
  await finish(db, job, "failed", reason, record, { status: "queued" });
  throw new TryAgain(reason);
}

/** The draft, checked: its supplier by tax ID, and that supplier's numbers already received. */
async function checked(
  db: Db,
  documentId: string,
  draft: ExtractedDocument,
  now: Date,
): Promise<DocumentChanges> {
  const taxId = draft.supplier.taxId && normalizeTaxId(draft.supplier.taxId);
  const [supplier] = taxId
    ? await db
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.taxId, taxId))
    : [];
  const known = supplier
    ? await db
        .select({ number: documents.number })
        .from(documents)
        .where(
          and(
            eq(documents.supplierId, supplier.id),
            ne(documents.id, documentId),
            isNotNull(documents.number),
          ),
        )
    : [];
  const { failures } = validate(draft, {
    today: today(now),
    maxAgeDays: MAX_AGE_DAYS,
    knownNumbers: known.map((k) => k.number!),
  });
  return {
    status: "ready_for_review",
    type: draft.documentType,
    supplierId: supplier?.id ?? null,
    number: draft.number,
    date: draft.issueDate,
    draft,
    checkFailures: failures,
    reviewNote: null,
  };
}

async function readOnce(context: ReadContext, job: ReadTry): Promise<void> {
  const { db, storage, reader, log } = context;
  const [claimed] = await db
    .update(documents)
    .set({ status: "reading" })
    .where(
      and(eq(documents.id, job.documentId), inArray(documents.status, WAITING)),
    )
    .returning({ id: documents.id });
  if (!claimed) {
    log.info(job, "document not waiting to be read: nothing to do");
    return;
  }

  let files: Uint8Array[];
  try {
    const stored = await db
      .select({ storageKey: documentFiles.storageKey })
      .from(documentFiles)
      .where(eq(documentFiles.documentId, job.documentId))
      .orderBy(asc(documentFiles.position));
    files = await Promise.all(stored.map((f) => storage.get(f.storageKey)));
  } catch (error) {
    log.warn({ ...job, err: error }, "document files not fetched");
    return tryAgain(db, job, "storage_error", null);
  }

  const { result } = await extractFiles(reader.client, files, {
    model: reader.model,
    prompt: reader.prompt,
    source: "client",
  });
  switch (result.status) {
    case "failed": {
      const reason =
        result.httpStatus === null ? "model_unreachable" : "model_error";
      log.warn(
        { ...job, reason, httpStatus: result.httpStatus },
        "read failed",
      );
      return tryAgain(db, job, reason, result.record);
    }
    case "rejected":
      // A broken photo, a PDF with too many pages: trying again wouldn't help.
      log.info({ ...job, reason: "unreadable" }, "document can't be read");
      return finish(db, job, "rejected", "unreadable", null, {
        status: "failed",
        failureReason: "unreadable",
      });
    case "needs-review":
      log.info({ ...job, outcome: "needs_review" }, "document read");
      return finish(db, job, "needs_review", null, result.record, {
        status: "ready_for_review",
        draft: null,
        checkFailures: null,
        reviewNote: result.reason,
      });
    case "extracted": {
      const changes = await checked(
        db,
        job.documentId,
        result.document,
        (context.now ?? (() => new Date()))(),
      );
      log.info({ ...job, outcome: "extracted" }, "document read");
      return finish(db, job, "extracted", null, result.record, changes);
    }
  }
}

/** One try, as the job runs it. Anything but a TryAgain is unexpected: recorded, and sent to Sentry. */
export async function tryReading(
  context: ReadContext,
  job: ReadTry,
): Promise<void> {
  try {
    await readOnce(context, job);
  } catch (error) {
    if (error instanceof TryAgain) throw error;
    context.log.error({ ...job, err: error }, "reading a document went wrong");
    Sentry.captureException(error, { tags: { documentId: job.documentId } });
    await finish(context.db, job, "failed", "unexpected", null, {
      status: "queued",
    }).catch(() => {});
    throw error;
  }
}

/**
 * The dead-letter queue's handler: the job ran out of tries. The document is failed with the
 * reason its last try recorded, or `interrupted` if that try never finished.
 */
export async function markFailed(
  db: Db,
  documentId: string,
  jobId: string,
): Promise<ExtractionFailure | null> {
  const [last] = await db
    .select({ failureReason: extractionAttempts.failureReason })
    .from(extractionAttempts)
    .where(
      and(
        eq(extractionAttempts.documentId, documentId),
        eq(extractionAttempts.jobId, jobId),
      ),
    )
    .orderBy(desc(extractionAttempts.try), desc(extractionAttempts.id))
    .limit(1);
  const reason = last?.failureReason ?? "interrupted";
  const [failed] = await db
    .update(documents)
    .set({ status: "failed", failureReason: reason })
    .where(
      and(eq(documents.id, documentId), inArray(documents.status, WAITING)),
    )
    .returning({ id: documents.id });
  if (!failed) return null;
  Sentry.captureMessage(`a document couldn't be read: ${reason}`, {
    level: "warning",
    tags: { documentId },
  });
  return reason;
}

/** The dead-letter handler, as the job runs it. */
export const failedRead = (db: Db) => (job: FailedRead) =>
  markFailed(db, job.documentId, job.jobId).then(() => undefined);
