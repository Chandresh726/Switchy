import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MatchWorkExecutionOptions } from "@/lib/ai/matcher/execution";
import type { MatcherConfig } from "@/lib/ai/matcher/types";

const mocks = vi.hoisted(() => ({
  getMatcherConfig: vi.fn(),
  getQueueStatus: vi.fn(),
  executeMatch: vi.fn(),
  createMatchSession: vi.fn(),
  finalizeMatchSession: vi.fn(),
  getUnmatchedJobIds: vi.fn(),
  createProgressTracker: vi.fn(),
  getMatchSessionCheckpoint: vi.fn(),
  getMatchSessionStatus: vi.fn(),
  updateMatchSessionIfActive: vi.fn(),
}));

vi.mock("@/lib/ai/matcher/config", () => ({
  getMatcherConfig: mocks.getMatcherConfig,
}));

vi.mock("@/lib/ai/matcher/queue", () => ({
  getQueueStatus: mocks.getQueueStatus,
}));

vi.mock("@/lib/ai/matcher/execution", () => ({
  executeConfiguredMatchWork: vi.fn(async (
    config: MatcherConfig,
    jobIds: number[],
    options: MatchWorkExecutionOptions = {}
  ) => {
    options.onQueued?.(1);
    if ((await options.onStart?.()) === false) return new Map();
    return mocks.executeMatch({
      config,
      jobIds,
      sessionId: options.sessionId,
      signal: options.signal,
      onProgress: options.onProgress,
      shouldStop: options.shouldStop,
    });
  }),
}));

vi.mock("@/lib/ai/matcher/tracking", () => ({
  createMatchSession: mocks.createMatchSession,
  finalizeMatchSession: mocks.finalizeMatchSession,
  getUnmatchedJobIds: mocks.getUnmatchedJobIds,
  createProgressTracker: mocks.createProgressTracker,
  getMatchSessionCheckpoint: mocks.getMatchSessionCheckpoint,
  getMatchSessionStatus: mocks.getMatchSessionStatus,
  updateMatchSessionIfActive: mocks.updateMatchSessionIfActive,
}));

import { createMatchEngine } from "@/lib/ai/matcher/engine";

describe("match engine integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getMatcherConfig.mockResolvedValue({
      model: "gpt-4.1-mini",
      reasoningEffort: "medium",
      bulkEnabled: true,
      batchSize: 2,
      maxRetries: 3,
      concurrencyLimit: 3,
      serializeOperations: false,
      interRequestDelayMs: 500,
      timeoutMs: 30000,
      backoffBaseDelay: 2000,
      backoffMaxDelay: 32000,
      circuitBreakerThreshold: 10,
      circuitBreakerResetTimeout: 60000,
      autoMatchAfterScrape: true,
    });

    mocks.getQueueStatus.mockReturnValue({
      isEnabled: false,
      pending: 0,
      size: 0,
      position: 0,
    });

    mocks.createProgressTracker.mockReturnValue({
      setPhase: vi.fn(),
      setStats: vi.fn(),
      setQueuePosition: vi.fn(),
      complete: vi.fn(),
    });

    mocks.updateMatchSessionIfActive.mockResolvedValue(true);
    mocks.getMatchSessionCheckpoint.mockResolvedValue({
      completedJobIds: [],
      succeeded: 0,
      failed: 0,
    });
    mocks.executeMatch.mockResolvedValue(new Map());
    mocks.finalizeMatchSession.mockResolvedValue({
      sessionId: "session-1",
      total: 2,
      succeeded: 0,
      failed: 2,
    });
  });

  it("forwards cancellation signals into direct single and bulk work", async () => {
    const controller = new AbortController();
    const matchResult = {
      score: 90,
      reasons: [],
      matchedSkills: [],
      missingSkills: [],
      recommendations: [],
    };
    mocks.executeMatch
      .mockResolvedValueOnce(new Map([[11, matchResult]]))
      .mockResolvedValueOnce(new Map([[11, matchResult]]));
    const engine = await createMatchEngine();

    await engine.matchSingle(11, controller.signal);
    await engine.matchBulk([11], undefined, controller.signal);

    expect(mocks.executeMatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ signal: controller.signal })
    );
    expect(mocks.executeMatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it("respects stopped session state and does not overwrite final totals", async () => {
    mocks.updateMatchSessionIfActive.mockResolvedValue(false);
    mocks.getMatchSessionStatus.mockResolvedValue({
      id: "session-1",
      status: "completed",
      jobsTotal: 2,
      jobsCompleted: 2,
      jobsSucceeded: 1,
      jobsFailed: 1,
      startedAt: new Date("2026-02-20T00:00:00.000Z"),
      completedAt: new Date("2026-02-20T00:01:00.000Z"),
    });

    const engine = await createMatchEngine();
    const result = await engine.matchWithTracking([11, 22], {
      sessionId: "session-1",
      triggerSource: "manual",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      total: 2,
      succeeded: 1,
      failed: 1,
    });

    expect(mocks.executeMatch).not.toHaveBeenCalled();
    expect(mocks.finalizeMatchSession).not.toHaveBeenCalled();
  });

  it("skips paid matching when a recovered session already checkpointed every job", async () => {
    mocks.getMatchSessionStatus.mockResolvedValue({
      id: "session-1",
      status: "in_progress",
      jobsTotal: 2,
      jobsCompleted: 2,
      jobsSucceeded: 1,
      jobsFailed: 1,
      startedAt: new Date("2026-02-20T00:00:00.000Z"),
      completedAt: null,
    });
    mocks.getMatchSessionCheckpoint.mockResolvedValue({
      completedJobIds: [11, 22],
      succeeded: 1,
      failed: 1,
    });
    mocks.finalizeMatchSession.mockResolvedValue({
      sessionId: "session-1",
      total: 2,
      succeeded: 1,
      failed: 1,
    });

    const engine = await createMatchEngine();
    const result = await engine.matchWithTracking([11, 22], {
      sessionId: "session-1",
      triggerSource: "auto_match",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      total: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(mocks.executeMatch).not.toHaveBeenCalled();
    expect(mocks.finalizeMatchSession).toHaveBeenCalledWith("session-1", 1, 1, 2);
  });

  it("matches only jobs missing from a recovered session checkpoint", async () => {
    mocks.getMatchSessionStatus.mockResolvedValue({
      id: "session-1",
      status: "in_progress",
      jobsTotal: 2,
      jobsCompleted: 1,
      jobsSucceeded: 1,
      jobsFailed: 0,
      startedAt: new Date("2026-02-20T00:00:00.000Z"),
      completedAt: null,
    });
    mocks.getMatchSessionCheckpoint.mockResolvedValue({
      completedJobIds: [11],
      succeeded: 1,
      failed: 0,
    });
    mocks.executeMatch.mockResolvedValue(
      new Map([
        [
          22,
          {
            score: 88,
            reasons: [],
            matchedSkills: [],
            missingSkills: [],
            recommendations: [],
          },
        ],
      ])
    );
    mocks.finalizeMatchSession.mockResolvedValue({
      sessionId: "session-1",
      total: 2,
      succeeded: 2,
      failed: 0,
    });

    const engine = await createMatchEngine();
    const result = await engine.matchWithTracking([11, 22], {
      sessionId: "session-1",
      triggerSource: "auto_match",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      total: 2,
      succeeded: 2,
      failed: 0,
    });
    expect(mocks.executeMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        jobIds: [22],
        sessionId: "session-1",
      })
    );
    expect(mocks.finalizeMatchSession).toHaveBeenCalledWith("session-1", 2, 0, 2);
  });

  it("persists queued state before transitioning to in_progress", async () => {
    mocks.getMatcherConfig.mockResolvedValue({
      model: "gpt-4.1-mini",
      reasoningEffort: "medium",
      bulkEnabled: true,
      batchSize: 2,
      maxRetries: 3,
      concurrencyLimit: 3,
      serializeOperations: true,
      interRequestDelayMs: 500,
      timeoutMs: 30000,
      backoffBaseDelay: 2000,
      backoffMaxDelay: 32000,
      circuitBreakerThreshold: 10,
      circuitBreakerResetTimeout: 60000,
      autoMatchAfterScrape: true,
    });

    mocks.executeMatch.mockResolvedValue(
      new Map([
        [
          11,
          {
            score: 85,
            reasons: [],
            matchedSkills: [],
            missingSkills: [],
            recommendations: [],
          },
        ],
      ])
    );
    mocks.getMatchSessionStatus.mockResolvedValue({
      id: "session-1",
      status: "in_progress",
      jobsTotal: 1,
      jobsCompleted: 1,
      jobsSucceeded: 1,
      jobsFailed: 0,
      startedAt: new Date("2026-02-20T00:00:00.000Z"),
      completedAt: null,
    });
    mocks.finalizeMatchSession.mockResolvedValue({
      sessionId: "session-1",
      total: 1,
      succeeded: 1,
      failed: 0,
    });

    const engine = await createMatchEngine();
    const result = await engine.matchWithTracking([11], {
      sessionId: "session-1",
      triggerSource: "manual",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      total: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(mocks.updateMatchSessionIfActive).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ status: "queued" })
    );
    expect(mocks.updateMatchSessionIfActive).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ status: "in_progress" })
    );
  });

  it("characterizes cumulative session progress for a resumed match", async () => {
    mocks.getMatchSessionStatus.mockResolvedValue({
      id: "session-1",
      status: "in_progress",
      jobsTotal: 3,
      jobsCompleted: 1,
      jobsSucceeded: 1,
      jobsFailed: 0,
      startedAt: new Date("2026-02-20T00:00:00.000Z"),
      completedAt: null,
    });
    mocks.getMatchSessionCheckpoint.mockResolvedValue({
      completedJobIds: [11],
      succeeded: 1,
      failed: 0,
    });
    mocks.executeMatch.mockImplementation(async ({ onProgress }) => {
      onProgress?.(1, 2, 1, 0);
      onProgress?.(2, 2, 1, 1);
      return new Map<number, Error | {
        score: number;
        reasons: string[];
        matchedSkills: string[];
        missingSkills: string[];
        recommendations: string[];
      }>([
        [22, { score: 80, reasons: [], matchedSkills: [], missingSkills: [], recommendations: [] }],
        [33, new Error("Provider timeout")],
      ]);
    });
    mocks.finalizeMatchSession.mockResolvedValue({
      sessionId: "session-1",
      total: 3,
      succeeded: 2,
      failed: 1,
    });

    const onProgress = vi.fn();
    const engine = await createMatchEngine();
    const result = await engine.matchWithTracking([11, 22, 33], {
      sessionId: "session-1",
      triggerSource: "manual",
      onProgress,
    });

    expect(result).toEqual({
      sessionId: "session-1",
      total: 3,
      succeeded: 2,
      failed: 1,
    });
    expect(mocks.createProgressTracker).toHaveBeenCalledWith(3, onProgress);
    expect(mocks.updateMatchSessionIfActive).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        status: "in_progress",
        jobsCompleted: 2,
        jobsSucceeded: 2,
        jobsFailed: 0,
        errorCount: 0,
      })
    );
    expect(mocks.updateMatchSessionIfActive).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        status: "in_progress",
        jobsCompleted: 3,
        jobsSucceeded: 2,
        jobsFailed: 1,
        errorCount: 1,
      })
    );
  });

  it("treats queued sessions as active for shouldStop and finalization checks", async () => {
    mocks.getMatcherConfig.mockResolvedValue({
      model: "gpt-4.1-mini",
      reasoningEffort: "medium",
      bulkEnabled: true,
      batchSize: 2,
      maxRetries: 3,
      concurrencyLimit: 3,
      serializeOperations: true,
      interRequestDelayMs: 500,
      timeoutMs: 30000,
      backoffBaseDelay: 2000,
      backoffMaxDelay: 32000,
      circuitBreakerThreshold: 10,
      circuitBreakerResetTimeout: 60000,
      autoMatchAfterScrape: true,
    });

    mocks.executeMatch.mockImplementation(async ({ shouldStop }) => {
      const stopped = await shouldStop?.();
      expect(stopped).toBe(false);
      return new Map([
        [
          11,
          {
            score: 90,
            reasons: [],
            matchedSkills: [],
            missingSkills: [],
            recommendations: [],
          },
        ],
      ]);
    });
    mocks.getMatchSessionStatus.mockResolvedValue({
      id: "session-1",
      status: "queued",
      jobsTotal: 1,
      jobsCompleted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      startedAt: new Date("2026-02-20T00:00:00.000Z"),
      completedAt: null,
    });
    mocks.finalizeMatchSession.mockResolvedValue({
      sessionId: "session-1",
      total: 1,
      succeeded: 1,
      failed: 0,
    });

    const engine = await createMatchEngine();
    const result = await engine.matchWithTracking([11], {
      sessionId: "session-1",
      triggerSource: "manual",
    });

    expect(result).toEqual({
      sessionId: "session-1",
      total: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(mocks.finalizeMatchSession).toHaveBeenCalledWith("session-1", 1, 0, 1);
  });

  it("preserves a resumed manual session checkpoint when matching fails", async () => {
    mocks.getMatchSessionStatus.mockResolvedValue({
      id: "session-1",
      status: "in_progress",
      jobsTotal: 2,
      jobsCompleted: 1,
      jobsSucceeded: 1,
      jobsFailed: 0,
      startedAt: new Date(),
      completedAt: null,
    });
    mocks.getMatchSessionCheckpoint
      .mockResolvedValueOnce({
        completedJobIds: [11],
        succeeded: 1,
        failed: 0,
      })
      .mockResolvedValueOnce({
        completedJobIds: [11],
        succeeded: 1,
        failed: 0,
      });
    const failure = new Error("provider unavailable");
    mocks.executeMatch.mockRejectedValue(failure);

    const engine = await createMatchEngine();

    await expect(
      engine.matchWithTracking([11, 22], {
        sessionId: "session-1",
        triggerSource: "manual",
      })
    ).rejects.toBe(failure);
    expect(mocks.updateMatchSessionIfActive).toHaveBeenLastCalledWith(
      "session-1",
      {
        status: "failed",
        jobsCompleted: 1,
        jobsSucceeded: 1,
        jobsFailed: 0,
        errorCount: 0,
      }
    );
    expect(mocks.finalizeMatchSession).not.toHaveBeenCalled();
  });

  it("preserves checkpoints and closes a manually cancelled session", async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    mocks.getMatchSessionStatus.mockResolvedValue({
      id: "session-1",
      status: "in_progress",
      jobsTotal: 1,
      jobsCompleted: 0,
      jobsSucceeded: 0,
      jobsFailed: 0,
      startedAt: new Date(),
      completedAt: null,
    });
    mocks.executeMatch.mockImplementation(
      async ({ signal }: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (!signal) throw new Error("Expected a cancellation signal.");
          started.resolve();
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        })
    );
    const engine = await createMatchEngine();
    const matching = engine.matchWithTracking([11], {
      sessionId: "session-1",
      signal: controller.signal,
    });
    await started.promise;
    const reason = new DOMException("request stopped", "AbortError");
    const rejection = expect(matching).rejects.toBe(reason);

    controller.abort(reason);

    await rejection;
    expect(mocks.updateMatchSessionIfActive).toHaveBeenLastCalledWith(
      "session-1",
      expect.objectContaining({
        status: "failed",
        jobsCompleted: 0,
        jobsSucceeded: 0,
        jobsFailed: 0,
      })
    );
    expect(mocks.finalizeMatchSession).not.toHaveBeenCalled();
  });
});
