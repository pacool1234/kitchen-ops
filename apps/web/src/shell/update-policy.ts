// When an open tab looks for a new version of the app, when it takes it, and what it does when
// a page's code is gone after a deploy (#139, decision 0042). Placeholder: the tests come first.

export const CHECK_EVERY_MS = 30 * 60 * 1000;
export const CHECK_AT_MOST_EVERY_MS = 60 * 1000;
export const RELOAD_AGAIN_AFTER_MS = 10 * 1000;

export interface PageVisibility {
  visible(): boolean;
  onChange(listener: () => void): () => void;
}

export function startUpdateChecks(
  _check: () => void,
  _page: PageVisibility,
): () => void {
  return () => {};
}

export function appliesOnNavigation(_state: {
  waiting: boolean;
  firstPage: boolean;
}): boolean {
  return false;
}

export function isMissingChunk(_error: unknown): boolean {
  return false;
}

export function reloadOnce(
  _path: string,
  _store: Pick<Storage, "getItem" | "setItem">,
  _now: number,
): boolean {
  return false;
}
