import { onUnmounted } from "vue";

// Checking again while a document is being read (#106, decision in the issue: polling, not
// server-sent events). Every 2 seconds while something is queued or being read and the page is
// visible; one request at a time; never after the page has gone.

/** How often a page asks again while a document is being read. */
export const POLL_MS = 2000;

export interface PollingOptions {
  readonly everyMs: number;
  /** Asks again. A failure is ignored: the next poll tries again. */
  readonly poll: () => Promise<void>;
  /** Whether there's anything to wait for. */
  readonly shouldPoll: () => boolean;
  readonly isHidden: () => boolean;
}

export interface Poller {
  /** Schedules the next poll, if there's something to wait for and none is due or running. */
  check(): void;
  stop(): void;
}

export function startPolling(options: PollingOptions): Poller {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let stopped = false;

  const due = () => options.shouldPoll() && !options.isHidden();

  async function run() {
    timer = undefined;
    // Things may have changed since it was scheduled: the tab hidden, the document read.
    if (stopped || !due()) return;
    running = true;
    try {
      await options.poll();
    } catch {
      // Offline for a moment, or the server restarting: the next poll tries again.
    } finally {
      running = false;
    }
    check();
  }

  function check() {
    if (stopped || running || timer !== undefined || !due()) return;
    timer = setTimeout(() => void run(), options.everyMs);
  }

  return {
    check,
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * Polls while the component is mounted: `check()` after each load. Pauses while the tab is
 * hidden, and checks again as soon as it's shown.
 */
export function usePolling(
  poll: () => Promise<void>,
  shouldPoll: () => boolean,
): Poller {
  const poller = startPolling({
    everyMs: POLL_MS,
    poll,
    shouldPoll,
    isHidden: () => document.visibilityState === "hidden",
  });
  const shown = () => poller.check();
  document.addEventListener("visibilitychange", shown);
  onUnmounted(() => {
    poller.stop();
    document.removeEventListener("visibilitychange", shown);
  });
  return poller;
}
