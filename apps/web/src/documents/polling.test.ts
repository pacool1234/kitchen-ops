import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling } from "./polling";

// Checking again while a document is being read (#106): every 2 seconds while there's something
// to wait for and the page is visible, never two requests at once, and never after stopping.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setUp() {
  const state = { waiting: true, hidden: false };
  const poll = vi.fn(async () => {});
  const poller = startPolling({
    everyMs: 2000,
    poll,
    shouldPoll: () => state.waiting,
    isHidden: () => state.hidden,
  });
  return { state, poll, poller };
}

describe("startPolling", () => {
  it("polls every 2 seconds while there's something to wait for", async () => {
    const { poll, poller } = setUp();
    poller.check();
    await vi.advanceTimersByTimeAsync(1999);
    expect(poll).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(poll).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it("stops when nothing is left to wait for, and starts again when told to check", async () => {
    const { state, poll, poller } = setUp();
    poller.check();
    await vi.advanceTimersByTimeAsync(2000);
    state.waiting = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(1);

    state.waiting = true;
    poller.check();
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("doesn't poll while the page is hidden, and starts again once it's shown", async () => {
    const { state, poll, poller } = setUp();
    state.hidden = true;
    poller.check();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(0);

    state.hidden = false;
    poller.check();
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it("never sends a request while the last one hasn't answered, however often it's told to check", async () => {
    let answer: () => void = () => {};
    const poll = vi.fn(
      () => new Promise<void>((resolve) => (answer = resolve)),
    );
    const poller = startPolling({
      everyMs: 2000,
      poll,
      shouldPoll: () => true,
      isHidden: () => false,
    });
    poller.check();
    await vi.advanceTimersByTimeAsync(2000);
    poller.check();
    poller.check();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(1);

    answer();
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("does nothing once stopped, even if told to check", async () => {
    const { poll, poller } = setUp();
    poller.check();
    poller.stop();
    poller.check();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(0);
  });

  it("a poll that fails doesn't stop the polling", async () => {
    const poll = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const poller = startPolling({
      everyMs: 2000,
      poll,
      shouldPoll: () => true,
      isHidden: () => false,
    });
    poller.check();
    await vi.advanceTimersByTimeAsync(4000);
    expect(poll).toHaveBeenCalledTimes(2);
    poller.stop();
  });
});
