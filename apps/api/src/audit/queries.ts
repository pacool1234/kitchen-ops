import type { AuditLogPage, AuditLogQuery } from "@kitchen-ops/shared";
import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { auditLog, users } from "../db/schema";

/** One page of the audit log, newest first, and how many entries match the filters in all. */
export async function listAuditLog(
  db: Db,
  query: AuditLogQuery,
): Promise<AuditLogPage> {
  const matching = and(
    query.entityType ? eq(auditLog.entityType, query.entityType) : undefined,
    query.entityId ? eq(auditLog.entityId, query.entityId) : undefined,
    query.userId ? eq(auditLog.userId, query.userId) : undefined,
    query.from ? gte(auditLog.occurredAt, new Date(query.from)) : undefined,
    query.to ? lt(auditLog.occurredAt, new Date(query.to)) : undefined,
  );

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        entry: auditLog,
        user: { id: users.id, name: users.name, email: users.email },
      })
      .from(auditLog)
      .innerJoin(users, eq(users.id, auditLog.userId))
      .where(matching)
      // Entries of one transaction share a time; their UUID v7 IDs keep them in order.
      .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(auditLog).where(matching),
  ]);

  return {
    entries: rows.map(({ entry, user }) => ({
      id: entry.id,
      occurredAt: entry.occurredAt.toISOString(),
      user,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      documentId: entry.documentId,
      requestId: entry.requestId,
      changes: entry.changes,
    })),
    total: counted?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}
