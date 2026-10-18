import type { ListStatus } from "@kitchen-ops/shared";
import { eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

// What every catalogue list shares (#88, decision 0026): search, status, order and pages.

/**
 * Rows whose `column` contains `text`, whatever its case and accents: "limon" finds "Limón".
 * The text means what it says: `%` and `_`, LIKE's wildcards, are escaped.
 */
export function contains(column: AnyColumn, text: string): SQL {
  // A backslash before each of them, and before a backslash itself: LIKE's escape character.
  const pattern = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  return sql`unaccent(${column}) ilike unaccent(${pattern})`;
}

/** The rows a status asks for: active, inactive, or (undefined: no condition) all. */
export function withStatus(active: AnyColumn, status: ListStatus) {
  return status === "all" ? undefined : eq(active, status === "active");
}

/** In Spanish alphabetical order: case and accents don't move a name ("Ámbar" before "Barra"). */
export function spanishOrder(column: AnyColumn): SQL {
  return sql`${column} collate "es-x-icu"`;
}

/** The rows of the page asked for. */
export function pageWindow(query: { page: number; pageSize: number }) {
  return { limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
}
