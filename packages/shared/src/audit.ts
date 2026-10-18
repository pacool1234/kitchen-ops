import { z } from "zod";

// The audit log (spec section 6, #87): who wrote what, when, and from which document.

/** What a write did. Posting and reversing documents come with the documents (M6). */
export const AUDIT_ACTIONS = ["create", "update", "delete"] as const;
export const AuditAction = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditAction>;

/** Each changed field, before and after, as JSON. Secrets show as "[redacted]". */
export const AuditChanges = z.record(
  z.string(),
  z.object({ before: z.unknown(), after: z.unknown() }),
);

export const AuditEntry = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
  user: z.object({ id: z.uuid(), name: z.string(), email: z.email() }),
  action: AuditAction,
  entityType: z.string(),
  entityId: z.string(),
  documentId: z.uuid().nullable(),
  /** The request that made the change: the API's x-request-id, also in its logs and Sentry. */
  requestId: z.string(),
  changes: AuditChanges,
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** Query of `GET /api/audit-log`: every filter optional, newest first, one page at a time. */
export const AuditLogQuery = z.object({
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  userId: z.uuid().optional(),
  /** From this moment, included. */
  from: z.iso.datetime({ offset: true }).optional(),
  /** Up to this moment, excluded. */
  to: z.iso.datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuery>;

/** Response of `GET /api/audit-log`. `total` counts every entry the filters match. */
export const AuditLogPage = z.object({
  entries: z.array(AuditEntry),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type AuditLogPage = z.infer<typeof AuditLogPage>;
