import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appliesOnNavigation,
  CHECK_AT_MOST_EVERY_MS,
  CHECK_EVERY_MS,
  isMissingChunk,
  RELOAD_AGAIN_AFTER_MS,
  reloadOnce,
  startUpdateChecks,
  type PageVisibility,
} from "./update-policy";

// When an open tab looks for a new version of the app, when it takes it, and what it does when
// a page's code is gone after a deploy (#139, decision 0042).

/** A page whose visibility the test sets, and tells its listeners about. */
function fakePage() {
  let visible = true;
  const listeners = new Set<() => void>();
  const page: PageVisibility = {
    visible: () => visible,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const become = (next: boolean) => {
    visible = next;
    for (const listener of listeners) listener();
  };
  return { page, become, listeners };
}

describe("checking for a new version", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks every 30 minutes", () => {
    const check = vi.fn();
    startUpdateChecks(check, fakePage().page);
    vi.advanceTimersByTime(CHECK_EVERY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CHECK_EVERY_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("asks when the tab is shown again, not when it's hidden", () => {
    const check = vi.fn();
    const { page, become } = fakePage();
    startUpdateChecks(check, page);
    vi.advanceTimersByTime(CHECK_AT_MOST_EVERY_MS);
    become(false);
    expect(check).not.toHaveBeenCalled();
    become(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("asks at most once a minute: shown, hidden and shown again in a moment asks once", () => {
    const check = vi.fn();
    const { page, become } = fakePage();
    startUpdateChecks(check, page);
    // Just loaded: the page has only now asked, on registering.
    become(false);
    become(true);
    expect(check).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CHECK_AT_MOST_EVERY_MS);
    become(false);
    become(true);
    become(false);
    become(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("stops asking once stopped", () => {
    const check = vi.fn();
    const { page, become, listeners } = fakePage();
    const stop = startUpdateChecks(check, page);
    stop();
    vi.advanceTimersByTime(CHECK_EVERY_MS * 2);
    become(false);
    become(true);
    expect(check).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
});

describe("taking a waiting version", () => {
  it("on moving to another page, once the app has started", () => {
    expect(appliesOnNavigation({ waiting: true, firstPage: false })).toBe(true);
  });

  it("not when no version is waiting", () => {
    expect(appliesOnNavigation({ waiting: false, firstPage: false })).toBe(
      false,
    );
  });

  it("not on the page the app starts on: it has only just loaded", () => {
    expect(appliesOnNavigation({ waiting: true, firstPage: true })).toBe(false);
  });
});

describe("a page whose code is gone", () => {
  it("is told by each browser's message, and Vite's for a stylesheet", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://example.test/assets/DocumentsView-abc123.js",
      "error loading dynamically imported module: https://example.test/assets/DocumentsView-abc123.js",
      "Importing a module script failed.",
      "Unable to preload CSS for /assets/DocumentsView-abc123.css",
    ]) {
      expect(isMissingChunk(new TypeError(message)), message).toBe(true);
    }
  });

  it("is not any other error", () => {
    expect(isMissingChunk(new TypeError("Failed to fetch"))).toBe(false);
    expect(isMissingChunk(new Error("x is undefined"))).toBe(false);
    expect(isMissingChunk("dynamically imported module")).toBe(false);
    expect(isMissingChunk(undefined)).toBe(false);
  });
});

describe("loading a page again when its code is gone", () => {
  function memoryStore() {
    const items = new Map<string, string>();
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
  }
  const t0 = 1_800_000_000_000;

  it("does it once for a page", () => {
    const store = memoryStore();
    expect(reloadOnce("/documents", store, t0)).toBe(true);
  });

  it("not again for the same page straight after: its code is really missing, and it would loop", () => {
    const store = memoryStore();
    reloadOnce("/documents", store, t0);
    expect(reloadOnce("/documents", store, t0 + 1_000)).toBe(false);
    expect(
      reloadOnce("/documents", store, t0 + RELOAD_AGAIN_AFTER_MS - 1),
    ).toBe(false);
  });

  it("again for the same page later, or for another page", () => {
    const store = memoryStore();
    reloadOnce("/documents", store, t0);
    expect(reloadOnce("/catalogue", store, t0 + 1_000)).toBe(true);
    const later = memoryStore();
    reloadOnce("/documents", later, t0);
    expect(reloadOnce("/documents", later, t0 + RELOAD_AGAIN_AFTER_MS)).toBe(
      true,
    );
  });

  it("not at all when it can't remember having done it: a loop is worse than an error", () => {
    const broken = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
    };
    expect(reloadOnce("/documents", broken, t0)).toBe(false);
  });

  it("ignores something else stored under its key", () => {
    const store = memoryStore();
    store.setItem("kitchen-ops:reloaded-for", "not json");
    expect(reloadOnce("/documents", store, t0)).toBe(true);
  });
});
