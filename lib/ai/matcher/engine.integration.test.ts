import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMatcherConfig: vi.fn(),
  withQueue: vi.fn(),
  getQueueStatus: vi.fn(),
  executeMatch: vi.fn(),
  createMatchSession: vi.fn(),
  finalizeMatchSession: vi.fn(),
  getUnmatchedJobIds: vi.fn(),
  createProgressTracker: vi.fn(),
  getMatchSessionStatus: vi.fn(),
  updateMatchSessionIfActive: vi.fn(),
}));

vi.mock("@/lib/ai/matcher/config", () => ({
  getMatcherConfig: mocks.getMatcherConfig,
}));

vi.mock("@/lib/ai/matcher/queue", () => ({
  withQueue: mocks.withQueue,
  getQueueStatus: mocks.getQueueStatus,
}));

vi.mock("@/lib/ai/matcher/execution", () => ({
  executeMatch: mocks.executeMatch,
}));

vi.mock("@/lib/ai/matcher/tracking", () => ({
  createMatchSession: mocks.createMatchSession,
  finalizeMatchSession: mocks.finalizeMatchSession,
  getUnmatchedJobIds: mocks.getUnmatchedJobIds,
  createProgressTracker: mocks.createProgressTracker,
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

    mocks.withQueue.mockImplementation(async (_config, work, onQueued) => {
      onQueued?.(1);
      return work();
    });

    mocks.createProgressTracker.mockReturnValue({
      setPhase: vi.fn(),
      setStats: vi.fn(),
      setQueuePosition: vi.fn(),
      complete: vi.fn(),
    });

    mocks.updateMatchSessionIfActive.mockResolvedValue(true);
    mocks.executeMatch.mockResolvedValue(new Map());
    mocks.finalizeMatchSession.mockResolvedValue({
      sessionId: "session-1",
      total: 2,
      succeeded: 0,
      failed: 2,
    });
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
});
