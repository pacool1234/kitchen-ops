import type { DocumentCheckFailure } from "@kitchen-ops/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLiveChecks } from "./live-checks";

// The checks run again as a draft is corrected (#118, decision 0037): a while after the last
// change, by the API, and only the newest version's answer is ever shown.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const failure = (path: string): DocumentCheckFailure => ({
  check: "line-total",
  path,
});

/** A check whose answers the test gives, one call at a time, in any order. */
function setUp() {
  const calls: {
    version: string;
    answer: (failures: DocumentCheckFailure[]) => void;
    fail: () => void;
  }[] = [];
  const check = vi.fn(
    (version: string) =>
      new Promise<DocumentCheckFailure[]>((resolve, reject) => {
        calls.push({
          version,
          answer: resolve,
          fail: () => reject(new Error("offline")),
        });
      }),
  );
  const shown: DocumentCheckFailure[][] = [];
  const live = startLiveChecks<string>({
    delayMs: 500,
    check,
    show: (failures) => shown.push(failures),
  });
  return { calls, check, shown, live };
}

describe("startLiveChecks", () => {
  it("checks once, 500 ms after the last change, the version as it is then", async () => {
    const { check, live } = setUp();
    live.changed("a");
    await vi.advanceTimersByTimeAsync(300);
    live.changed("ab");
    await vi.advanceTimersByTimeAsync(499);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith("ab");
  });

  it("shows an answer when it comes", async () => {
    const { calls, shown, live } = setUp();
    live.changed("a");
    await vi.advanceTimersByTimeAsync(500);
    calls[0]!.answer([failure("lines.0.lineTotal")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([[failure("lines.0.lineTotal")]]);
  });

  it("an older version's answer, come late, is never shown: not after a newer one's, nor while a newer one is asked", async () => {
    const { calls, shown, live } = setUp();
    live.changed("old");
    await vi.advanceTimersByTimeAsync(500);
    live.changed("new");
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.map((c) => c.version)).toEqual(["old", "new"]);

    calls[0]!.answer([failure("old")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([]);
    calls[1]!.answer([failure("new")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([[failure("new")]]);
  });

  it("a change while waiting for an answer makes that answer old", async () => {
    const { calls, shown, live } = setUp();
    live.changed("a");
    await vi.advanceTimersByTimeAsync(500);
    live.changed("ab");
    calls[0]!.answer([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([]);
  });

  it("a check that fails shows nothing: the failures shown stay as they were", async () => {
    const { calls, shown, live } = setUp();
    live.changed("a");
    await vi.advanceTimersByTimeAsync(500);
    calls[0]!.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toEqual([]);
  });

  it("stopped, it checks nothing more and shows nothing more", async () => {
    const { calls, check, shown, live } = setUp();
    live.changed("a");
    await vi.advanceTimersByTimeAsync(500);
    live.changed("ab");
    live.stop();
    calls[0]!.answer([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(shown).toEqual([]);
  });

  it("a version that can't be checked (it fails the schema) cancels the check waiting, and makes any answer old", async () => {
    const { calls, check, shown, live } = setUp();
    live.changed("a");
    await vi.advanceTimersByTimeAsync(500);
    live.cancel();
    calls[0]!.answer([]);
    live.changed("b");
    live.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(shown).toEqual([]);
  });
});
