import { describe, expect, it, vi } from "vitest";

import type { ScrapeQueueItem } from "@/lib/db/schema";

import {
  LocalLeasedWorkRunner,
  type LocalLeasedWorkStore,
} from "@/lib/scraper/runtime/leased-work-runner";
import type { QueueRecoveryResult } from "@/lib/scraper/queue/types";
import { createScrapeQueueItem } from "@test/fixtures/scraper/queue-items";

function createRepository(
  items: ScrapeQueueItem[]
): LocalLeasedWorkStore<ScrapeQueueItem, QueueRecoveryResult> {
  const pending = [...items];
  return {
    claimNext: vi.fn(async () => pending.shift() ?? null),
    heartbeat: vi.fn(async () => true),
    isCancellationRequested: vi.fn(async () => false),
    complete: vi.fn(async () => true),
    release: vi.fn(async () => true),
    retry: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
    recoverExpired: vi.fn(async () => ({ requeued: 0, failed: 0, cancelled: 0 })),
    getNextAvailableAt: vi.fn(async () => null),
  };
}

describe("LocalLeasedWorkRunner", () => {
  it("recovers expired leases before claiming and persists successful results", async () => {
    const repository = createRepository([createScrapeQueueItem()]);
    vi.mocked(repository.recoverExpired).mockResolvedValue({
      requeued: 1,
      failed: 0,
      cancelled: 0,
    });
    const runner = new LocalLeasedWorkRunner(
      repository,
      async () => ({ outcome: "success", jobsAdded: 2 }),
      { concurrency: 1 }
    );

    const summary = await runner.runAvailable();

    expect(repository.recoverExpired).toHaveBeenCalledBefore(
      vi.mocked(repository.claimNext)
    );
    expect(repository.complete).toHaveBeenCalledWith(
      "item-1",
      expect.stringMatching(/^local-/),
      JSON.stringify({ outcome: "success", jobsAdded: 2 }),
      expect.any(Date)
    );
    expect(summary).toMatchObject({
      claimed: 1,
      completed: 1,
      recovered: { requeued: 1, failed: 0, cancelled: 0 },
    });
  });

  it("requeues retryable attempts with an exponential availability delay", async () => {
    const repository = createRepository([
      createScrapeQueueItem({ attemptCount: 2, maxAttempts: 3 }),
    ]);
    const runner = new LocalLeasedWorkRunner(
      repository,
      async () => {
        throw new Error("temporary failure");
      },
      { concurrency: 1, baseRetryDelayMs: 1_000, maxRetryDelayMs: 10_000 }
    );
    const before = Date.now();

    const summary = await runner.runAvailable();

    expect(repository.retry).toHaveBeenCalledWith(
      "item-1",
      expect.any(String),
      "temporary failure",
      expect.any(Date),
      expect.any(Date)
    );
    const retryAt = vi.mocked(repository.retry).mock.calls[0]?.[3];
    expect(retryAt?.getTime()).toBeGreaterThanOrEqual(before + 2_000);
    expect(summary.retried).toBe(1);
  });

  it("permanently fails work after the final attempt", async () => {
    const repository = createRepository([
      createScrapeQueueItem({ attemptCount: 3, maxAttempts: 3 }),
    ]);
    const runner = new LocalLeasedWorkRunner(
      repository,
      async () => {
        throw new Error("permanent failure");
      },
      { concurrency: 1 }
    );

    const summary = await runner.runAvailable();

    expect(repository.fail).toHaveBeenCalledWith(
      "item-1",
      expect.any(String),
      "permanent failure",
      expect.any(Date)
    );
    expect(summary.failed).toBe(1);
  });

  it("aborts and marks running work cancelled when its durable flag is set", async () => {
    const repository = createRepository([createScrapeQueueItem()]);
    vi.mocked(repository.isCancellationRequested).mockResolvedValue(true);
    const runner = new LocalLeasedWorkRunner(
      repository,
      async (_item, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      { concurrency: 1, heartbeatIntervalMs: 100 }
    );

    const summary = await runner.runAvailable();

    expect(repository.cancel).toHaveBeenCalledWith(
      "item-1",
      expect.any(String),
      expect.any(Date)
    );
    expect(summary.cancelled).toBe(1);
    expect(repository.heartbeat).not.toHaveBeenCalled();
  });

  it("persists cancellation requested after a handler finishes instead of completing", async () => {
    const repository = createRepository([createScrapeQueueItem()]);
    vi.mocked(repository.isCancellationRequested).mockResolvedValue(true);
    const runner = new LocalLeasedWorkRunner(repository, async () => ({ done: true }), {
      concurrency: 1,
    });

    const summary = await runner.runAvailable();

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.cancel).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({ completed: 0, cancelled: 1 });
  });

  it("does not retry a handler failure after its session is cancelled", async () => {
    const repository = createRepository([createScrapeQueueItem()]);
    vi.mocked(repository.isCancellationRequested).mockResolvedValue(true);
    const runner = new LocalLeasedWorkRunner(
      repository,
      async () => {
        throw new Error("session stopped during persistence");
      },
      { concurrency: 1 }
    );

    const summary = await runner.runAvailable();

    expect(repository.retry).not.toHaveBeenCalled();
    expect(repository.cancel).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({ retried: 0, cancelled: 1 });
  });

  it("releases final-attempt work without consuming the attempt when stopped", async () => {
    const repository = createRepository([createScrapeQueueItem({ attemptCount: 3, maxAttempts: 3 })]);
    const handlerStarted = Promise.withResolvers<void>();
    const runner = new LocalLeasedWorkRunner(
      repository,
      async (_item, { signal }) => {
        handlerStarted.resolve();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      { concurrency: 1 }
    );

    const runPromise = runner.runAvailable();
    await handlerStarted.promise;
    runner.stop();
    const summary = await runPromise;

    expect(repository.release).toHaveBeenCalledWith(
      "item-1",
      expect.any(String),
      3,
      expect.any(Date)
    );
    expect(repository.retry).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
    expect(repository.cancel).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ retried: 0, failed: 0, cancelled: 0 });
  });

  it("can be run again after lease recovery fails", async () => {
    const repository = createRepository([]);
    vi.mocked(repository.recoverExpired)
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({ requeued: 0, failed: 0, cancelled: 0 });
    const runner = new LocalLeasedWorkRunner(repository, async () => undefined, {
      concurrency: 1,
    });

    await expect(runner.runAvailable()).rejects.toThrow("database unavailable");
    await expect(runner.runAvailable()).resolves.toMatchObject({ claimed: 0 });
  });

  it("renews leases before one third of a configured lease elapses", async () => {
    vi.useFakeTimers();
    try {
      const repository = createRepository([createScrapeQueueItem()]);
      const handlerStarted = Promise.withResolvers<void>();
      const runner = new LocalLeasedWorkRunner(
        repository,
        async (_item, { signal }) => {
          handlerStarted.resolve();
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
        { concurrency: 1, leaseDurationMs: 1_000, heartbeatIntervalMs: 5_000 }
      );

      const runPromise = runner.runAvailable();
      await handlerStarted.promise;
      await vi.advanceTimersByTimeAsync(334);

      expect(repository.heartbeat).toHaveBeenCalledOnce();
      runner.stop();
      await runPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops and awaits sibling workers before surfacing a worker failure", async () => {
    const repository = createRepository([
      createScrapeQueueItem({ id: "item-1" }),
      createScrapeQueueItem({ id: "item-2" }),
    ]);
    vi.mocked(repository.retry).mockImplementation(async (itemId) => {
      if (itemId === "item-1") throw new Error("queue transition failed");
      return true;
    });
    let siblingStopped = false;
    const runner = new LocalLeasedWorkRunner(
      repository,
      async (item, { signal }) => {
        if (item.id === "item-1") throw new Error("scrape failed");
        try {
          return await new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        } finally {
          siblingStopped = true;
        }
      },
      { concurrency: 2 }
    );

    await expect(runner.runAvailable()).rejects.toThrow("queue transition failed");

    expect(siblingStopped).toBe(true);
    expect(repository.release).toHaveBeenCalledWith(
      "item-2",
      expect.any(String),
      1,
      expect.any(Date)
    );
  });

  it("persists cancellation that races between the monitor read and heartbeat", async () => {
    vi.useFakeTimers();
    try {
      const repository = createRepository([createScrapeQueueItem()]);
      vi.mocked(repository.isCancellationRequested)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      vi.mocked(repository.heartbeat).mockResolvedValue(false);
      const runner = new LocalLeasedWorkRunner(
        repository,
        async (_item, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
        { concurrency: 1, heartbeatIntervalMs: 100 }
      );

      const runPromise = runner.runAvailable();
      await vi.advanceTimersByTimeAsync(100);
      const summary = await runPromise;

      expect(repository.heartbeat).toHaveBeenCalledOnce();
      expect(repository.cancel).toHaveBeenCalledWith(
        "item-1",
        expect.any(String),
        expect.any(Date)
      );
      expect(summary.cancelled).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases work claimed while a stop request is waiting on the database", async () => {
    const repository = createRepository([]);
    const claim = Promise.withResolvers<ScrapeQueueItem | null>();
    const claimStarted = Promise.withResolvers<void>();
    vi.mocked(repository.claimNext).mockImplementationOnce(async () => {
      claimStarted.resolve();
      return claim.promise;
    });
    const handler = vi.fn(async () => undefined);
    const runner = new LocalLeasedWorkRunner(repository, handler, { concurrency: 1 });

    const runPromise = runner.runAvailable();
    await claimStarted.promise;
    runner.stop();
    claim.resolve(createScrapeQueueItem({ attemptCount: 1 }));
    const summary = await runPromise;

    expect(handler).not.toHaveBeenCalled();
    expect(repository.release).toHaveBeenCalledWith(
      "item-1",
      expect.any(String),
      1,
      expect.any(Date)
    );
    expect(summary.claimed).toBe(1);
  });
});
