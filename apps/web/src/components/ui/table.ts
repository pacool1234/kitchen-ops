import type { Locale } from "@kitchen-ops/shared";
import { INTL_LOCALE } from "../../i18n/format";

// Sorting and paging a table (#85). DataTable is controlled: these run in the page for a list
// it holds whole, and the API does the same for a list it pages (the catalogue, #89).

export type SortDirection = "asc" | "desc";
export interface Sort {
  key: string;
  direction: SortDirection;
}

/** How a column's values compare: as words, or as decimal strings such as amounts. */
export interface SortColumn<Row> {
  key: string;
  sortAs?: "text" | "decimal";
  value: (row: Row) => string;
}

/** Clicking a header: a new column sorts ascending, the same one flips. */
export function nextSort(current: Sort | null, key: string): Sort {
  if (current?.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
}

/** How many pages `total` rows fill. An empty table still has its one, empty, page. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** The rows a page shows, counting from 1: page 2 of 20 is rows 21 to 40. */
export function pageBounds(
  page: number,
  size: number,
  total: number,
): { first: number; last: number } {
  if (total === 0) return { first: 0, last: 0 };
  return { first: (page - 1) * size + 1, last: Math.min(page * size, total) };
}

/** The rows on `page` (from 1). */
export function pageRows<T>(
  rows: readonly T[],
  page: number,
  size: number,
): T[] {
  return rows.slice((page - 1) * size, page * size);
}

/** A decimal string as a whole number of its smallest unit, at `places` decimals. */
function scaled(decimal: string, places: number): bigint {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = decimal.replace("-", "").split(".");
  const units = BigInt(whole + fraction.padEnd(places, "0"));
  return negative ? -units : units;
}

/** Orders two decimal strings by value, exactly at any size: negative, 0 or positive. */
export function compareDecimal(a: string, b: string): number {
  const places = Math.max(
    a.split(".")[1]?.length ?? 0,
    b.split(".")[1]?.length ?? 0,
  );
  const [x, y] = [scaled(a, places), scaled(b, places)];
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The rows in a column's order, as a new array. Text follows the language's alphabet (in
 * Spanish, ñ comes after n), ignoring capitals and accents; ties keep their order.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  sort: Sort | null,
  columns: readonly SortColumn<Row>[],
  locale: Locale,
): Row[] {
  const column = sort && columns.find((c) => c.key === sort.key);
  if (!sort || !column) return [...rows];
  const collator = new Intl.Collator(INTL_LOCALE[locale], {
    sensitivity: "base",
    numeric: true,
  });
  const compare =
    column.sortAs === "decimal" ? compareDecimal : collator.compare;
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) => compare(column.value(a), column.value(b)) * direction,
  );
}
