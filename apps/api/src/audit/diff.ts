// What an audit entry says changed (#87, decision 0025): each changed field, before and after,
// as JSON. Passwords, secrets, tokens and sessions are never kept: the entry says the field
// changed, not to what (issue #87's notes).

/** A value as the audit log stores it: JSON. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AuditChanges = Record<
  string,
  { before: JsonValue; after: JsonValue }
>;

/** What a secret's value is replaced with. */
export const REDACTED = "[redacted]";

/** Field names whose values are never logged: password, twoFactorSecret, apiKey, sessionId… */
const SENSITIVE = /password|secret|token|session|api_?key/i;

/** A value as JSON: a bigint as its digits (money, decision 0015), a date as ISO text. */
function toJson(value: unknown): JsonValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, toJson(inner)]),
    );
  }
  return value as JsonValue;
}

/** The same JSON text for the same content, whatever the order of an object's keys. */
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const redact = (key: string, value: JsonValue): JsonValue =>
  value !== null && SENSITIVE.test(key) ? REDACTED : value;

/**
 * The fields that differ between `before` and `after`, each with both values. `before` is null
 * for a creation and `after` for a deletion. Nothing changed gives `{}`.
 */
export function diffChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditChanges {
  const changes: AuditChanges = {};
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  for (const key of keys) {
    const old = toJson(before?.[key]);
    const now = toJson(after?.[key]);
    if (canonical(old) !== canonical(now)) {
      changes[key] = { before: redact(key, old), after: redact(key, now) };
    }
  }
  return changes;
}
