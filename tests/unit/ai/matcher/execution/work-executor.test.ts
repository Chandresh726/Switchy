import { beforeEach, describe, expect, it, vi } from "vitest";

import { InProcessLocalDataOperationGate } from "@/lib/scraper/runtime/data-operation-gate";
import type { MatcherConfig } from "@/lib/ai/matcher/types";

const mocks = vi.hoisted(() => ({
  executeMatch: vi.fn(),
  withQueue: vi.fn(
    async (_config: MatcherConfig, operation: () => Promise<unknown>) =>
      operation()
  ),
}));

vi.mock("@/lib/ai/matcher/execution/executor", () => ({
  executeMatch: mocks.executeMatch,
}));

vi.mock("@/lib/ai/matcher/config", () => ({
  getMatcherConfig: vi.fn(),
}));

vi.mock("@/lib/ai/matcher/queue", () => ({
  withQueue: mocks.withQueue,
}));

import { executeConfiguredMatchWork } from "@/lib/ai/matcher/execution/work-executor";

const config: MatcherConfig = {
  model: "test-model",
  reasoningEffort: "medium",
  bulkEnabled: false,
  batchSize: 1,
  maxRetries: 1,
  concurrencyLimit: 1,
  serializeOperations: false,
  interRequestDelayMs: 0,
  timeoutMs: 1_000,
  backoffBaseDelay: 0,
  backoffMaxDelay: 0,
  circuitBreakerThreshold: 1,
  circuitBreakerResetTimeout: 1_000,
  autoMatchAfterScrape: false,
};

describe("executeConfiguredMatchWork data fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels an untracked direct match before destructive maintenance clears data", async () => {
    const matchStarted = Promise.withResolvers<void>();
    const cancellationObserved = Promise.withResolvers<void>();
    mocks.executeMatch.mockImplementation(async (options: { signal: AbortSignal }) => {
      matchStarted.resolve();
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            cancellationObserved.resolve();
            reject(options.signal.reason);
          },
          { once: true }
        );
      });
    });
    const gate = new InProcessLocalDataOperationGate();

    const matching = executeConfiguredMatchWork(config, [42], {}, gate);
    await matchStarted.promise;
    gate.cancelMatches();
    let cleared = false;
    const maintenance = gate.runMaintenance(() => {
      cleared = true;
    });
    await Promise.resolve();

    await cancellationObserved.promise;
    expect(cleared).toBe(false);
    await expect(matching).rejects.toMatchObject({ name: "AbortError" });
    await maintenance;
    expect(cleared).toBe(true);
  });
});
