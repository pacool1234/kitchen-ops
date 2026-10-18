import type { AuditAction } from "@kitchen-ops/shared";
import type { FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { auditLog } from "../db/schema";
import { diffChanges } from "./diff";

// The one way to write (#87, decision 0025): the change and its audit entry in one transaction,
// so either both are saved or neither is. Lint refuses db.insert, db.update and db.delete in
// the API's features; the transaction `audited` hands over is the way in.

/** A transaction: what `audited` hands to the work it runs. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Who is writing, and in which request. */
export interface AuditContext {
  userId: string;
  requestId: string;
}

/** One entity a write changed: its values before and after. */
export interface AuditedChange {
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** null when the entity is created. */
  before: Record<string, unknown> | null;
  /** null when the entity is deleted. */
  after: Record<string, unknown> | null;
  /** The supplier document behind the change, if there is one. */
  documentId?: string;
}

/** The context of a signed-in request: its user and its ID (the x-request-id header). */
export function auditContext(request: FastifyRequest): AuditContext {
  if (!request.user) {
    throw new Error("an audited write needs a signed-in user");
  }
  return { userId: request.user.id, requestId: request.id };
}

/**
 * Runs `work` in a transaction, then records one audit entry for each entity it says it
 * changed, in the same transaction. A change that changed nothing records nothing. If anything
 * throws, nothing is saved.
 */
export async function audited<T>(
  db: Db,
  context: AuditContext,
  work: (tx: Tx) => Promise<{ result: T; changes: readonly AuditedChange[] }>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const { result, changes } = await work(tx);
    const entries = changes
      .map((change) => ({
        change,
        fields: diffChanges(change.before, change.after),
      }))
      .filter(({ fields }) => Object.keys(fields).length > 0)
      .map(({ change, fields }) => ({
        userId: context.userId,
        requestId: context.requestId,
        action: change.action,
        entityType: change.entityType,
        entityId: change.entityId,
        documentId: change.documentId ?? null,
        changes: fields,
      }));
    if (entries.length > 0) await tx.insert(auditLog).values(entries);
    return result;
  });
}
