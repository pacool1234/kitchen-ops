import { DOCUMENT_STATUSES, type DocumentStatus } from "@kitchen-ops/shared";
import type { LocationQuery, LocationQueryRaw } from "vue-router";

// The documents list (#106): its status filter and page live in the URL, like the catalogue's
// lists (decision 0027), so the back button and a refresh keep them.

export interface DocumentListState {
  /** "" for every status. */
  status: DocumentStatus | "";
  page: number;
}

const first = (value: LocationQuery[string] | undefined): string => {
  const text = Array.isArray(value) ? value[0] : value;
  return text ?? "";
};

/** The list's state from the URL's query. Anything it can't read is the default. */
export function readDocumentQuery(query: LocationQuery): DocumentListState {
  const status = first(query.status);
  const page = Number(first(query.page));
  return {
    status: (DOCUMENT_STATUSES as readonly string[]).includes(status)
      ? (status as DocumentStatus)
      : "",
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

/** The URL's query for a state: only what isn't the default. */
export function writeDocumentQuery(state: DocumentListState): LocationQueryRaw {
  const query: LocationQueryRaw = {};
  if (state.status) query.status = state.status;
  if (state.page !== 1) query.page = String(state.page);
  return query;
}

/** Whether any of these documents is still waiting to be read, or being read. */
export function inProgress(
  documents: readonly { status: DocumentStatus }[],
): boolean {
  return documents.some((d) => d.status === "queued" || d.status === "reading");
}

/** The line a failed check's field is on, counted from 1: "lines.3.unitPrice" is line 4. */
export function failureLine(path: string): number | null {
  const match = /^lines\.(\d+)(\.|$)/.exec(path);
  return match ? Number(match[1]) + 1 : null;
}
