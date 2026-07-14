import { describe, expect, it, vi } from "vitest";

import type { MatchResultMap } from "@/lib/ai/matcher/types";
import type { ScrapeMatchOutboxItem } from "@/lib/db/schema";
import { MatchWorkHandler } from "@/lib/scraper/matching/match-work-handler";
import type { MatchWorkStore } from "@/lib/scraper/matching/match-work-store";

vi.mock("@/lib/ai/matcher/execution/work-executor", () => ({ executeMatchWork: vi.fn() }));

function createItem(): ScrapeMatchOutboxItem {
  const now = new Date();
  return {
    id: "match-1",
    scrapingLogId: 1,
    companyId: 1,
    jobIdsJson: "[1,2]",
    status: "running",
    attemptCount: 1,
    maxAttempts: 3,
    availableAt: now,
    workerId: "worker-1",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

function createStore(): MatchWorkStore {
  return {
    claimNext: vi.fn(async () => null),
    heartbeat: vi.fn(async () => true),
    isCancellationRequested: vi.fn(async () => false),
    complete: vi.fn(async () => true),
    release: vi.fn(async () => true),
    retry: vi.fn(async () => true),
    fail: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
    recoverExpired: vi.fn(async () => 0),
    getNextAvailableAt: vi.fn(async () => null),
    getExecutionState: vi.fn(async () => ({
      checkpoint: { completedJobIds: [1], succeeded: 1, failed: 0 },
      completedResult: null,
    })),
    markQueued: vi.fn(async () => true),
    markStarted: vi.fn(async () => true),
    updateProgress: vi.fn(async () => true),
    stopSession: vi.fn(async () => ({
      exists: true,
      stopped: true,
      status: "failed",
    })),
  };
}

describe("MatchWorkHandler", () => {
  it("executes only uncheckpointed jobs and reports cumulative progress", async () => {
    const store = createStore();
    const execute = vi.fn(async (jobIds, options): Promise<MatchResultMap> => {
      options.onQueued?.(2);
      await options.onStart?.();
      options.onProgress?.(1, 1, 0, 1);
      return new Map([[jobIds[0], new Error("provider rejected job")]]);
    });
    const handler = new MatchWorkHandler(store, execute);

    const result = await handler.handle(
      createItem(),
      new AbortController().signal,
      "worker-1"
    );

    expect(execute).toHaveBeenCalledWith(
      [2],
      expect.objectContaining({
        sessionId: "match-1",
        signal: expect.any(AbortSignal),
      })
    );
    expect(store.markQueued).toHaveBeenCalledWith(
      "match-1",
      "worker-1",
      expect.objectContaining({ succeeded: 1 })
    );
    expect(store.updateProgress).toHaveBeenCalledWith(
      "match-1",
      "worker-1",
      2,
      1,
      1
    );
    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
  });

  it("rejects stale progress after work ownership is lost", async () => {
    const store = createStore();
    vi.mocked(store.updateProgress).mockResolvedValue(false);
    let executionSignal: AbortSignal | undefined;
    const execute = vi.fn(async (_jobIds, options): Promise<MatchResultMap> => {
      await options.onStart?.();
      executionSignal = options.signal;
      options.onProgress?.(1, 1, 1, 0);
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => reject(options.signal?.reason),
          { once: true }
        );
      });
    });
    const handler = new MatchWorkHandler(store, execute);

    await expect(
      handler.handle(createItem(), new AbortController().signal, "worker-1")
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(executionSignal?.aborted).toBe(true);
  });

  it("propagates cancellation to the lower-level executor", async () => {
    const store = createStore();
    const execute = vi.fn(
      async (_jobIds, options): Promise<MatchResultMap> =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true }
          );
        })
    );
    const handler = new MatchWorkHandler(store, execute);
    const controller = new AbortController();
    const completion = handler.handle(createItem(), controller.signal, "worker-1");
    const reason = new DOMException("lease lost", "AbortError");
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());

    controller.abort(reason);

    await expect(completion).rejects.toBe(reason);
  });
});
