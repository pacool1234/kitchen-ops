// When an open tab looks for a new version of the app, when it takes it, and what it does when
// a page's code is gone after a deploy (#139, decision 0042). Plain functions, so they're tested
// without a service worker; app-update.ts wires them to the real one.

/** How often an open tab asks for a new version. */
export const CHECK_EVERY_MS = 30 * 60 * 1000;
/** Showing and hiding a tab asks no more often than this. */
export const CHECK_AT_MOST_EVERY_MS = 60 * 1000;
/** A page loaded again for its missing code isn't loaded again for it within this. */
export const RELOAD_AGAIN_AFTER_MS = 10 * 1000;

/** Whether the tab is shown, and a way to hear when that changes. */
export interface PageVisibility {
  visible(): boolean;
  /** Returns a function that stops listening. */
  onChange(listener: () => void): () => void;
}

/**
 * Calls `check` every 30 minutes, and when the tab is shown again (a phone brings the app back
 * to the front), but not twice within a minute. The page has just asked, on registering, so
 * the first check waits too. Returns a function that stops it.
 */
export function startUpdateChecks(
  check: () => void,
  page: PageVisibility,
): () => void {
  let last = Date.now();
  const run = () => {
    const now = Date.now();
    if (now - last < CHECK_AT_MOST_EVERY_MS) return;
    last = now;
    check();
  };
  const timer = setInterval(run, CHECK_EVERY_MS);
  const stopListening = page.onChange(() => {
    if (page.visible()) run();
  });
  return () => {
    clearInterval(timer);
    stopListening();
  };
}

/**
 * A waiting version is taken on moving to another page in the app: the unsaved-changes guard has
 * already let the move go, so nothing unsaved is lost. Not on the page the app starts on.
 */
export function appliesOnNavigation({
  waiting,
  firstPage,
}: {
  waiting: boolean;
  firstPage: boolean;
}): boolean {
  return waiting && !firstPage;
}

/** The messages Chrome, Firefox and Safari give for a module that won't load, and Vite's for CSS. */
const MISSING_CHUNK =
  /dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** Whether a page failed to open because its code isn't on the server any more. */
export function isMissingChunk(error: unknown): boolean {
  return error instanceof Error && MISSING_CHUNK.test(error.message);
}

const RELOADED_KEY = "kitchen-ops:reloaded-for";

/**
 * Whether to load `path` again for its missing code: yes once, and not again for the same path
 * within 10 seconds, when its code is really missing and loading it again would loop. If the
 * store can't say, no: an error on screen is better than a loop.
 */
export function reloadOnce(
  path: string,
  store: Pick<Storage, "getItem" | "setItem">,
  now: number,
): boolean {
  try {
    const last = lastReload(store.getItem(RELOADED_KEY));
    if (last && last.path === path && now - last.at < RELOAD_AGAIN_AFTER_MS) {
      return false;
    }
    store.setItem(RELOADED_KEY, JSON.stringify({ path, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** What `reloadOnce` stored, or undefined for nothing, or something it didn't store. */
function lastReload(
  stored: string | null,
): { path: string; at: number } | undefined {
  if (stored === null) return undefined;
  try {
    const value: unknown = JSON.parse(stored);
    if (
      typeof value === "object" &&
      value !== null &&
      "path" in value &&
      "at" in value &&
      typeof value.path === "string" &&
      typeof value.at === "number"
    ) {
      return { path: value.path, at: value.at };
    }
  } catch {
    // Not ours.
  }
  return undefined;
}
