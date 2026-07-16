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

import { analyzeJobsForMatching } from "@/lib/ai/matcher/evidence/job-analysis";
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

  it("reports each ready analysis and isolates a failed multi-job batch", async () => {
    const secondJob = { ...job, id: 2, title: "Platform Engineer" };
    mocks.getOrCreateJobAnalysis.mockImplementation(async (input) => ({
      id: `analysis-${input.evidence.summary}`,
      aiRunId: "run-split",
      evidence: input.evidence,
    }));
    mocks.executeStructured
      .mockRejectedValueOnce(new Error("multi-job output was malformed"))
      .mockResolvedValueOnce({ runId: "run-1", output: [providerOutput] })
      .mockResolvedValueOnce({
        runId: "run-2",
        output: [{ ...providerOutput, jobId: 2, summary: "Platform engineering role." }],
      });
    const onReady = vi.fn();

    const results = await analyzeJobsForMatching(
      [job, secondJob],
      { ...config, batchSize: 2 },
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
