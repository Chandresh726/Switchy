import { describe, expect, it, vi } from "vitest";

import {
  abortableDelay,
  createScrapeAbortError,
  getActiveScrapeSignal,
  runWithScrapeSignal,
  throwIfScrapeAborted,
} from "@/lib/scraper/infrastructure/cancellation";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("scrape cancellation scope", () => {
  it("isolates concurrent async signal contexts", async () => {
    const first = new AbortController();
    const second = new AbortController();
    const firstReady = deferred();
    const secondReady = deferred();
    const release = deferred();

    const firstTask = runWithScrapeSignal(first.signal, async () => {
      firstReady.resolve();
      await secondReady.promise;
      expect(getActiveScrapeSignal()).toBe(first.signal);
      await release.promise;
      expect(getActiveScrapeSignal()).toBe(first.signal);
    });
    const secondTask = runWithScrapeSignal(second.signal, async () => {
      secondReady.resolve();
      await firstReady.promise;
      expect(getActiveScrapeSignal()).toBe(second.signal);
      await release.promise;
      expect(getActiveScrapeSignal()).toBe(second.signal);
    });

    await Promise.all([firstReady.promise, secondReady.promise]);
    release.resolve();
    await Promise.all([firstTask, secondTask]);
    expect(getActiveScrapeSignal()).toBeUndefined();
  });

  it("restores an outer signal after a nested scope completes", async () => {
    const outer = new AbortController();
    const inner = new AbortController();

    await runWithScrapeSignal(outer.signal, async () => {
      expect(getActiveScrapeSignal()).toBe(outer.signal);
      await runWithScrapeSignal(inner.signal, async () => {
        expect(getActiveScrapeSignal()).toBe(inner.signal);
      });
      expect(getActiveScrapeSignal()).toBe(outer.signal);
    });
  });

  it("aborts a pending delay and removes its timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = abortableDelay(60_000, controller.signal);

    controller.abort(new Error("session stopped"));

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "session stopped",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves explicit abort errors and rethrows them from active scopes", async () => {
    const controller = new AbortController();
    const reason = new DOMException("lease lost", "AbortError");
    controller.abort(reason);

    expect(createScrapeAbortError(controller.signal)).toBe(reason);
    await expect(
      runWithScrapeSignal(controller.signal, async () => {
        throwIfScrapeAborted();
      })
    ).rejects.toBe(reason);
  });
});
