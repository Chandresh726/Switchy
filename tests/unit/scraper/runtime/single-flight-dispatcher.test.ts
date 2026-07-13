import { describe, expect, it, vi } from "vitest";

import { ScheduledSingleFlightDispatcher } from "@/lib/scraper/runtime/single-flight-dispatcher";

interface DispatchResult {
  nextAvailableAt: Date | null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("ScheduledSingleFlightDispatcher", () => {
  it("coalesces concurrent callers and runs one requested follow-up", async () => {
    const firstRun = deferred<{ nextAvailableAt: Date | null }>();
    const run = vi
      .fn()
      .mockReturnValueOnce(firstRun.promise)
      .mockResolvedValue({ nextAvailableAt: null });
    const dispatcher = new ScheduledSingleFlightDispatcher<DispatchResult>({
      run,
      getNextRunAt: (result) => result.nextAvailableAt,
      failureRetryMs: 100,
      onError: vi.fn(),
    });

    const first = dispatcher.request();
    const concurrent = dispatcher.request();

    expect(concurrent).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
    firstRun.resolve({ nextAvailableAt: null });
    await first;
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it("can observe an active run without scheduling a redundant follow-up", async () => {
    const activeRun = deferred<{ nextAvailableAt: Date | null }>();
    const run = vi.fn(() => activeRun.promise);
    const dispatcher = new ScheduledSingleFlightDispatcher<DispatchResult>({
      run,
      failureRetryMs: 100,
      onError: vi.fn(),
    });

    const first = dispatcher.request();
    const observed = dispatcher.request({ rerunIfActive: false });
    activeRun.resolve({ nextAvailableAt: null });
    await Promise.all([first, observed]);
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("schedules the next durable availability time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        nextAvailableAt: new Date("2026-07-13T00:00:00.100Z"),
      })
      .mockResolvedValue({ nextAvailableAt: null });
    const dispatcher = new ScheduledSingleFlightDispatcher<DispatchResult>({
      run,
      getNextRunAt: (result) => result.nextAvailableAt,
      failureRetryMs: 50,
      onError: vi.fn(),
    });

    await dispatcher.request();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(99);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("reports failures and retries after the configured bounded delay", async () => {
    vi.useFakeTimers();
    const error = new Error("dispatch failed");
    const onError = vi.fn();
    const run = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ nextAvailableAt: null });
    const dispatcher = new ScheduledSingleFlightDispatcher<DispatchResult>({
      run,
      failureRetryMs: 25,
      onError,
    });

    await expect(dispatcher.request()).rejects.toBe(error);
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
    await vi.advanceTimersByTimeAsync(24);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
