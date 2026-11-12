import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findJobAnalysis: vi.fn(),
  getOrCreateJobAnalysis: vi.fn(),
  createAICapabilityRuntime: vi.fn(),
  executeStructured: vi.fn(),
}));

vi.mock("@/lib/ai/artifacts", () => ({
  artifactRepository: {
    findJobAnalysis: mocks.findJobAnalysis,
    getOrCreateJobAnalysis: mocks.getOrCreateJobAnalysis,
  },
}));

vi.mock("@/lib/ai/runtime/capability-runtime", () => ({
  createAICapabilityRuntime: mocks.createAICapabilityRuntime,
}));

import { AIRateLimitError } from "@/lib/ai/shared/errors";
import { analyzeJobsForMatching, buildJobAnalysisVersion } from "@/lib/ai/matcher/evidence/job-analysis";
import { DEFAULT_MATCHER_CONFIG, type JobData } from "@/lib/ai/matcher/types";

const job: JobData = {
  id: 1,
  title: "Senior TypeScript Engineer",
  description: "Requirements:\n- Build services with TypeScript\n- AWS preferred",
  location: "Remote",
  locationType: "remote",
  salary: null,
  department: "engineering",
  employmentType: "full-time",
  seniorityLevel: "senior",
};

const config = {
  ...DEFAULT_MATCHER_CONFIG,
  jobAnalysisProviderId: "provider-1",
  jobAnalysisModel: "analysis-model",
  jobAnalysisReasoningEffort: "medium",
};

const providerOutput = {
  jobId: 1,
  summary: "Senior engineering role building TypeScript services.",
  requirements: [{
    id: "provider-id",
    type: "technology",
    text: "Build services with TypeScript",
    importance: "important",
    sourceEvidence: "Build services with TypeScript",
  }],
};

describe("AI-only job analysis service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findJobAnalysis.mockResolvedValue(null);
    mocks.getOrCreateJobAnalysis.mockImplementation(async (input) => ({
      id: "analysis-1",
      evidence: input.evidence,
    }));
    mocks.createAICapabilityRuntime.mockResolvedValue({
      reasoningEffort: "medium",
      executeStructured: mocks.executeStructured,
    });
    mocks.executeStructured.mockResolvedValue({ runId: "run-1", output: [providerOutput] });
  });

  it("reuses a current AI analysis without resolving a provider", async () => {
    mocks.findJobAnalysis.mockResolvedValue({ id: "cached", evidence: providerOutput });

    const results = await analyzeJobsForMatching([job], config);

    expect(results.get(1)?.jobAnalysisId).toBe("cached");
    expect(mocks.createAICapabilityRuntime).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent analysis by fingerprint and reuses the completed artifact", async () => {
    let cached: { id: string; evidence: typeof providerOutput } | null = null;
    mocks.findJobAnalysis.mockImplementation(async () => cached);
    mocks.getOrCreateJobAnalysis.mockImplementation(async () => {
      cached = { id: "shared-analysis", evidence: providerOutput };
      return cached;
    });
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    mocks.executeStructured.mockImplementation(async () => {
      started.resolve();
      await release.promise;
      return { runId: "shared-run", output: [providerOutput] };
    });
    const firstRun = analyzeJobsForMatching([job], config);
    await started.promise;
    const secondRun = analyzeJobsForMatching([job], config);
    await vi.waitFor(() => expect(mocks.findJobAnalysis).toHaveBeenCalledTimes(3));
    release.resolve();
    const [first, second] = await Promise.all([firstRun, secondRun]);
    expect(mocks.executeStructured).toHaveBeenCalledTimes(1);
    expect(first.get(1)?.jobAnalysisId).toBe("shared-analysis");
    expect(second.get(1)?.jobAnalysisId).toBe("shared-analysis");
  });

  it("keys fallback analysis artifacts by the actual producing model", async () => {
    mocks.executeStructured.mockResolvedValue({ runId: "alternate-run", output: [providerOutput],
      resolvedModel: { providerRecordId: "alternate-provider", modelId: "alternate-model" }, reasoningEffort: "low" });
    const results = await analyzeJobsForMatching([job], config);
    const version = buildJobAnalysisVersion({ ...config, jobAnalysisProviderId: "alternate-provider",
      jobAnalysisModel: "alternate-model", jobAnalysisReasoningEffort: "low" });
    expect(mocks.getOrCreateJobAnalysis).toHaveBeenCalledWith(expect.objectContaining({ extractorVersion: version, aiRunId: "alternate-run" }));
    expect(results.get(1)?.analysisVersion).toBe(version);
  });

  it("persists only successful AI analysis with run provenance", async () => {
    await analyzeJobsForMatching([job], config);

    expect(mocks.getOrCreateJobAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      aiRunId: "run-1",
      extractorVersion: expect.stringMatching(/^job-analysis-ai-v2-/),
    }));
    expect(mocks.executeStructured).toHaveBeenCalledWith(expect.objectContaining({
      versions: {
        prompt: "job-analysis-prompt-v7",
        schema: "job-analysis-schema-v7",
        policy: "job-analysis-policy-v7",
      },
    }));
  });

  it("does not create an artifact when model resolution fails", async () => {
    mocks.createAICapabilityRuntime.mockRejectedValue(new Error("provider unavailable"));

    await expect(analyzeJobsForMatching([job], config)).rejects.toThrow("provider unavailable");
    expect(mocks.getOrCreateJobAnalysis).not.toHaveBeenCalled();
  });

  it("does not create a fallback artifact when structured generation fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.executeStructured.mockRejectedValue(new Error("invalid output"));

    const results = await analyzeJobsForMatching([job], config);

    expect(results.size).toBe(0);
    expect(mocks.getOrCreateJobAnalysis).not.toHaveBeenCalled();
  });

  it("isolates invalid stored job data without aborting valid jobs", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const invalidJob = { ...job, id: 2, department: "x".repeat(501) };
    const onFailed = vi.fn();

    const results = await analyzeJobsForMatching(
      [invalidJob, job],
      config,
      undefined,
      undefined,
      undefined,
      { onFailed }
    );

    expect(results.has(1)).toBe(true);
    expect(results.has(2)).toBe(false);
    expect(onFailed).toHaveBeenCalledWith(
      [2],
      expect.objectContaining({ type: "validation", retryable: false })
    );
    expect(mocks.executeStructured).toHaveBeenCalledOnce();
  });

  it("does not split a throttled five-job batch or mark it terminally failed", async () => {
    const error = new AIRateLimitError("limited", undefined, 90_000);
    mocks.executeStructured.mockRejectedValue(error);
    const onFailed = vi.fn();
    await expect(analyzeJobsForMatching(Array.from({ length: 5 }, (_, i) => ({ ...job, id: i + 1 })),
      { ...config, batchSize: 5 }, undefined, undefined, undefined, { onFailed })).rejects.toBe(error);
    expect(mocks.executeStructured).toHaveBeenCalledTimes(1);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("reports each ready analysis and isolates a failed multi-job batch", async () => {
    const secondJob = { ...job, id: 2, title: "Platform Engineer" };
    mocks.getOrCreateJobAnalysis.mockImplementation(async (input) => ({
      id: `analysis-${input.evidence.summary}`,
      aiRunId: "run-split",
      evidence: input.evidence,
    }));
    mocks.executeStructured
      .mockRejectedValueOnce(Object.assign(new Error("JSON parse: malformed multi-job output"), { name: "SyntaxError" }))
      .mockResolvedValueOnce({ runId: "run-1", output: [providerOutput] })
      .mockResolvedValueOnce({
        runId: "run-2",
        output: [{ ...providerOutput, jobId: 2, summary: "Platform engineering role." }],
      });
    const onReady = vi.fn();

    const results = await analyzeJobsForMatching(
      [job, secondJob],
      { ...config, batchSize: 2, maxRetries: 1 },
      undefined,
      undefined,
      undefined,
      { onReady }
    );

    expect(mocks.executeStructured).toHaveBeenCalledTimes(3);
    expect(results.size).toBe(2);
    expect(onReady).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledWith(
      expect.objectContaining({ job: expect.objectContaining({ id: 1 }) }),
      "generated"
    );
  });
});
