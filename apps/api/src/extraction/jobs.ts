import { sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import { fromDrizzle, PgBoss } from "pg-boss";
import type { Tx } from "../audit/audited";

// Background jobs (#104, decision 0030): pg-boss, a queue kept in Postgres, in its own `pgboss`
// schema, which it creates and migrates itself (Drizzle doesn't see it). The worker runs inside
// the API process. A job is queued in the same transaction as the document it reads, so there's
// never a document without its job. An error is tried again with backoff, 3 tries in all; after
// the last, pg-boss moves the job to a dead-letter queue, whose handler marks the document failed.
// The same happens when a try never finishes (the server restarted): its job expires and is
// tried again.

export const READ_QUEUE = "read-document";
export const FAILED_READ_QUEUE = "read-document-failed";

/** Tries in all: the first, and 2 more after an error. */
export const TRIES = 3;

/** How long one try may take before pg-boss gives up on it and tries again. */
const TRY_SECONDS = 15 * 60;

export interface JobSettings {
  /** Seconds before the next try; with backoff, about twice as long each time, up to 10 minutes. */
  retryDelaySeconds: number;
  retryBackoff: boolean;
  /** How often an idle worker looks for jobs. */
  pollingIntervalSeconds: number;
}

export const JOB_SETTINGS: JobSettings = {
  retryDelaySeconds: 30,
  retryBackoff: true,
  pollingIntervalSeconds: 2,
};

interface ReadJobData {
  readonly documentId: string;
}

/** One try at reading a document: the job, its document, and which try it is, from 1. */
export interface ReadTry {
  readonly jobId: string;
  readonly documentId: string;
  readonly try: number;
}

/** A job that ran out of tries: its document, and the job's own ID (the dead letter has another). */
export interface FailedRead {
  readonly documentId: string;
  readonly jobId: string;
}

export interface Jobs {
  /** Creates pg-boss's tables if they aren't there, and the queues. */
  start(): Promise<void>;
  /** Queues reading a document in the transaction that saves it: both happen, or neither. */
  queueRead(tx: Tx, documentId: string): Promise<void>;
  /** Starts working: documents are read one at a time. A handler that throws is tried again. */
  work(handlers: {
    read(job: ReadTry): Promise<void>;
    failed(job: FailedRead): Promise<void>;
  }): Promise<void>;
  /** Lets the try under way finish, for up to 30 seconds, then stops. */
  stop(): Promise<void>;
}

export function createJobs(
  databaseUrl: string,
  settings: JobSettings,
  log: FastifyBaseLogger,
): Jobs {
  // A small pool: the worker, pg-boss's own upkeep, and nothing else. Queuing uses the API's.
  const boss = new PgBoss({
    connectionString: databaseUrl,
    max: 3,
    schedule: false,
  });
  boss.on("error", (error) => log.error({ err: error }, "background jobs"));
  let started = false;

  const readQueue = {
    retryLimit: TRIES - 1,
    retryDelay: settings.retryDelaySeconds,
    retryBackoff: settings.retryBackoff,
    // pg-boss allows a cap only with backoff.
    ...(settings.retryBackoff ? { retryDelayMax: 10 * 60 } : {}),
    expireInSeconds: TRY_SECONDS,
    deadLetter: FAILED_READ_QUEUE,
  };
  const failedQueue = {
    retryLimit: 5,
    retryDelay: settings.retryDelaySeconds,
    retryBackoff: settings.retryBackoff,
  };
  const working = {
    batchSize: 1,
    includeMetadata: true,
    pollingIntervalSeconds: settings.pollingIntervalSeconds,
  } as const;

  return {
    async start() {
      await boss.start();
      started = true;
      // Creating a queue that exists changes nothing, so its settings are updated too: a
      // change made here takes effect on the next start.
      await boss.createQueue(FAILED_READ_QUEUE, failedQueue);
      await boss.updateQueue(FAILED_READ_QUEUE, failedQueue);
      await boss.createQueue(READ_QUEUE, readQueue);
      await boss.updateQueue(READ_QUEUE, readQueue);
    },

    async queueRead(tx, documentId) {
      const data: ReadJobData = { documentId };
      await boss.send(READ_QUEUE, data, { db: fromDrizzle(tx, sql) });
    },

    async work(handlers) {
      await boss.work<ReadJobData, void, typeof working>(
        READ_QUEUE,
        working,
        async ([job]) => {
          await handlers.read({
            jobId: job!.id,
            documentId: job!.data.documentId,
            try: job!.retryCount + 1,
          });
        },
      );
      await boss.work<ReadJobData, void, typeof working>(
        FAILED_READ_QUEUE,
        working,
        async ([job]) => {
          await handlers.failed({
            documentId: job!.data.documentId,
            jobId: job!.sourceId ?? job!.id,
          });
        },
      );
    },

    async stop() {
      if (!started) return;
      started = false;
      await boss.stop({ graceful: true, timeout: 30_000 });
    },
  };
}
