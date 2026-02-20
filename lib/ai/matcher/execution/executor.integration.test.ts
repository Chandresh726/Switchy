import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAIContextFromExplicitConfig: vi.fn(),
  createCircuitBreaker: vi.fn(),
  categorizeError: vi.fn(),
  selectStrategy: vi.fn(),
  singleStrategy: vi.fn(),
  bulkStrategy: vi.fn(),
  parallelStrategy: vi.fn(),
  fetchJobsData: vi.fn(),
  fetchProfileData: vi.fn(),
  updateJobWithMatchResult: vi.fn(),
  logMatchSuccess: vi.fn(),
  logMatchFailure: vi.fn(),
}));

vi.mock("@/lib/ai/runtime-context", () => ({
  resolveAIContextFromExplicitConfig: mocks.resolveAIContextFromExplicitConfig,
}));

vi.mock("@/lib/ai/matcher/resilience", () => ({
  createCircuitBreaker: mocks.createCircuitBreaker,
  categorizeError: mocks.categorizeError,
}));

vi.mock("@/lib/ai/matcher/strategies", () => ({
  selectStrategy: mocks.selectStrategy,
  singleStrategy: mocks.singleStrategy,
  bulkStrategy: mocks.bulkStrategy,
  parallelStrategy: mocks.parallelStrategy,
}));

vi.mock("@/lib/ai/matcher/tracking", () => ({
  fetchJobsData: mocks.fetchJobsData,
  fetchProfileData: mocks.fetchProfileData,
  updateJobWithMatchResult: mocks.updateJobWithMatchResult,
  logMatchSuccess: mocks.logMatchSuccess,
  logMatchFailure: mocks.logMatchFailure,
}));

import { executeMatch } from "@/lib/ai/matcher/execution/executor";

describe("executeMatch integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.resolveAIContextFromExplicitConfig.mockResolvedValue({
      model: {} as never,
      modelId: "gpt-4.1-mini",
      providerOptions: undefined,
    });

    mocks.createCircuitBreaker.mockReturnValue({
      canExecute: () => true,
      onSuccess: () => undefined,
      onFailure: () => undefined,
      getState: () => ({ isOpen: false }),
    });

    mocks.categorizeError.mockReturnValue("unknown");
  });

  it("returns deterministic failures when profile data is missing", async () => {
    mocks.fetchJobsData.mockResolvedValue(
      new Map([
        [
          101,
          {
            id: 101,
            title: "Backend Engineer",
            description: "Node.js and TypeScript",
          },
        ],
      ])
    );
    mocks.fetchProfileData.mockResolvedValue(null);

    const results = await executeMatch({
      config: {
        model: "gpt-4.1-mini",
        reasoningEffort: "medium",
        bulkEnabled: false,
        batchSize: 1,
        maxRetries: 3,
        concurrencyLimit: 1,
        serializeOperations: false,
        interRequestDelayMs: 500,
        timeoutMs: 30000,
        backoffBaseDelay: 2000,
        backoffMaxDelay: 32000,
        circuitBreakerThreshold: 10,
        circuitBreakerResetTimeout: 60000,
        autoMatchAfterScrape: true,
      },
      jobIds: [101],
      sessionId: "session-1",
    });

    const item = results.get(101);
    expect(item).toBeInstanceOf(Error);
    expect((item as Error).message).toBe("No profile found");
    expect(mocks.updateJobWithMatchResult).not.toHaveBeenCalled();
    expect(mocks.logMatchSuccess).not.toHaveBeenCalled();
    expect(mocks.logMatchFailure).not.toHaveBeenCalled();
  });

  it("persists mixed success and failure results without duplication", async () => {
    mocks.fetchJobsData.mockResolvedValue(
      new Map([
        [
          1,
          {
            id: 1,
            title: "Backend Engineer",
            description: "5+ years of experience with Node.js",
          },
        ],
        [
          2,
          {
            id: 2,
            title: "Frontend Engineer",
            description: "React and TypeScript",
          },
        ],
      ])
    );

    mocks.fetchProfileData.mockResolvedValue({
      profile: { id: 1, summary: "Experienced engineer" },
      skills: [],
      experience: [],
      education: [],
    });

    mocks.selectStrategy.mockReturnValue("parallel");
    mocks.parallelStrategy.mockResolvedValue(
      new Map([
        [
          1,
          {
            result: {
              score: 82,
              reasons: ["Strong skill overlap"],
              matchedSkills: ["TypeScript"],
              missingSkills: ["Kubernetes"],
              recommendations: ["Add cloud projects"],
            },
            duration: 15,
            attemptCount: 1,
          },
        ],
        [
          2,
          {
            error: new Error("Provider timeout"),
            duration: 20,
            attemptCount: 2,
          },
        ],
      ])
    );
    mocks.categorizeError.mockReturnValue("timeout");

    const results = await executeMatch({
      config: {
        model: "gpt-4.1-mini",
        reasoningEffort: "medium",
        bulkEnabled: true,
        batchSize: 2,
        maxRetries: 3,
        concurrencyLimit: 2,
        serializeOperations: false,
        interRequestDelayMs: 500,
        timeoutMs: 30000,
        backoffBaseDelay: 2000,
        backoffMaxDelay: 32000,
        circuitBreakerThreshold: 10,
        circuitBreakerResetTimeout: 60000,
        autoMatchAfterScrape: true,
      },
      jobIds: [1, 2],
      sessionId: "session-2",
    });

    expect(results.get(1)).toMatchObject({ score: 82 });
    expect(results.get(2)).toBeInstanceOf(Error);

    expect(mocks.updateJobWithMatchResult).toHaveBeenCalledTimes(1);
    expect(mocks.updateJobWithMatchResult).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ score: 82 })
    );

    expect(mocks.logMatchSuccess).toHaveBeenCalledTimes(1);
    expect(mocks.logMatchFailure).toHaveBeenCalledTimes(1);
    expect(mocks.logMatchFailure).toHaveBeenCalledWith(
      "session-2",
      2,
      20,
      "timeout",
      "Provider timeout",
      2,
      "gpt-4.1-mini"
    );
  });
});
