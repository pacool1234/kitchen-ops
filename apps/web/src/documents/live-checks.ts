import type { DocumentCheckFailure } from "@kitchen-ops/shared";

// The checks run again as a draft is corrected (#118, decision 0037). They're the API's (they
// use the ledger's arithmetic, which the web app can't import), so they're asked for a while
// after the last change, not on every key. Answers can come back in any order: only the newest
// version's is ever shown.

export interface LiveChecks<V> {
  /** The version changed: check it once it's stayed the same for a while. */
  changed(version: V): void;
  /** The version can't be checked (it fails the schema): drop any check waiting or asked. */
  cancel(): void;
  /** No more checks, nor answers shown: the page is gone. */
  stop(): void;
}

export function startLiveChecks<V>(options: {
  delayMs: number;
  check: (version: V) => Promise<DocumentCheckFailure[]>;
  show: (failures: DocumentCheckFailure[]) => void;
}): LiveChecks<V> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Counts versions: an answer is shown only if no version has come since it was asked. */
  let latest = 0;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    latest += 1;
  }

  return {
    changed(version) {
      cancel();
      const asked = latest;
      timer = setTimeout(() => {
        timer = undefined;
        options.check(version).then(
          (failures) => {
            if (asked === latest) options.show(failures);
          },
          // Offline, or refused: the failures shown stay, and saving will say what's wrong.
          () => {},
        );
      }, options.delayMs);
    },
    cancel,
    stop: cancel,
  };
}
