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
  description: "Requirements:\n- 5+ years of experience\n- TypeScript\n- AWS preferred",
  location: "Remote",
  locationType: "remote",
  salary: null,
  department: "engineering",
  employmentType: "full-time",
  seniorityLevel: "senior",
};

describe("job analysis cache and fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findJobAnalysis.mockResolvedValue(null);
    mocks.getOrCreateJobAnalysis.mockImplementation(async (input) => ({
      id: "analysis-1",
      evidence: input.evidence,
    }));
  });

  it("reuses unchanged job analysis without resolving a provider", async () => {
    mocks.findJobAnalysis.mockResolvedValue({
      id: "cached-analysis",
      evidence: {
        mustHaveSkills: ["typescript"],
        preferredSkills: ["amazon web services"],
        minimumExperienceYears: 5,
        seniorityLevel: "senior",
        managementTrack: null,
        educationRequirements: [],
        locationConstraints: ["remote"],
        employmentType: "full-time",
        compensationText: null,
        domainKeywords: [],
        extractionConfidence: 0.9,
        ambiguities: [],
      },
    });

    const results = await analyzeJobsForMatching([job], DEFAULT_MATCHER_CONFIG);

    expect(results.get(1)?.jobAnalysisId).toBe("cached-analysis");
    expect(mocks.createAICapabilityRuntime).not.toHaveBeenCalled();
    expect(mocks.getOrCreateJobAnalysis).not.toHaveBeenCalled();
  });

  it("persists deterministic low-confidence evidence when provider resolution fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.createAICapabilityRuntime.mockRejectedValue(
      new Error("provider exposed SENTINEL_JOB_DESCRIPTION")
    );

    const results = await analyzeJobsForMatching([job], DEFAULT_MATCHER_CONFIG);

    expect(results.get(1)?.analysis).toMatchObject({
      minimumExperienceYears: 5,
      extractionConfidence: 0.25,
    });
    expect(mocks.getOrCreateJobAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      aiRunId: undefined,
      evidence: expect.objectContaining({ ambiguities: [expect.stringContaining("fallback")] }),
    }));
    expect(JSON.stringify(warning.mock.calls)).not.toContain("SENTINEL_JOB_DESCRIPTION");
    warning.mockRestore();
  });

  it("links successful structured extraction to its job-analysis run", async () => {
    mocks.createAICapabilityRuntime.mockResolvedValue({
      reasoningEffort: "medium",
      executeStructured: mocks.executeStructured,
    });
    mocks.executeStructured.mockResolvedValue({
      runId: "run-1",
      output: [{
        jobId: 1,
        mustHaveSkills: ["TypeScript"],
        preferredSkills: ["TS", "aws"],
        minimumExperienceYears: 5,
        seniorityLevel: "senior",
        managementTrack: null,
        educationRequirements: [],
        locationConstraints: ["remote"],
        employmentType: "full-time",
        compensationText: null,
        domainKeywords: [],
        extractionConfidence: 0.9,
        ambiguities: [],
        requirements: [{
          id: "provider-id-is-replaced",
          type: "technology",
          text: "TypeScript for backend services",
          terms: ["TypeScript", "TS"],
          alternatives: [],
          importance: "important",
          explicitness: "explicit",
          experienceYears: null,
          experienceScope: null,
          sourceEvidence: "TypeScript",
          confidence: 0.95,
        }, {
          id: "provider-id-is-replaced-2",
          type: "technology",
          text: "AWS appears in the current stack",
          terms: ["AWS"],
          alternatives: [],
          importance: "contextual",
          explicitness: "implied",
          experienceYears: null,
          experienceScope: null,
          sourceEvidence: "AWS preferred",
          confidence: 0.8,
        }],
      }],
    });

    await analyzeJobsForMatching([job], DEFAULT_MATCHER_CONFIG);

    expect(mocks.getOrCreateJobAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      aiRunId: "run-1",
      evidence: expect.objectContaining({
        mustHaveSkills: ["typescript"],
        preferredSkills: ["amazon web services"],
        requirements: [
          expect.objectContaining({
            id: "requirement:1",
            terms: ["typescript"],
            importance: "important",
          }),
          expect.objectContaining({
            id: "requirement:2",
            terms: ["amazon web services"],
            importance: "preferred",
          }),
        ],
      }),
    }));
    expect(mocks.executeStructured).toHaveBeenCalledWith(expect.objectContaining({
      versions: {
        prompt: "job-analysis-prompt-v5",
        schema: "job-analysis-schema-v5",
        policy: "job-analysis-policy-v5",
      },
    }));
  });

  it("keeps deterministic fallback artifacts retryable after provider recovery", async () => {
    mocks.createAICapabilityRuntime.mockRejectedValueOnce(new Error("temporary outage"));

    await analyzeJobsForMatching([job], DEFAULT_MATCHER_CONFIG);

    expect(mocks.getOrCreateJobAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({
      extractorVersion: "job-analysis-v5-fallback",
      aiRunId: undefined,
    }));

    mocks.createAICapabilityRuntime.mockResolvedValue({
      reasoningEffort: "medium",
      executeStructured: mocks.executeStructured,
    });
    mocks.executeStructured.mockResolvedValue({
      runId: "recovered-run",
      output: [{
        jobId: 1,
        mustHaveSkills: ["TypeScript"],
        preferredSkills: [],
        minimumExperienceYears: 5,
        seniorityLevel: "senior",
        managementTrack: null,
        educationRequirements: [],
        locationConstraints: ["Remote"],
        employmentType: "full-time",
        compensationText: null,
        domainKeywords: [],
        extractionConfidence: 0.9,
        ambiguities: [],
        requirements: [{
          id: "model-id",
          type: "technology",
          text: "TypeScript",
          terms: ["TypeScript"],
          alternatives: [],
          importance: "important",
          explicitness: "explicit",
          experienceYears: null,
          experienceScope: null,
          sourceEvidence: "TypeScript",
          confidence: 0.9,
        }],
      }],
    });

    await analyzeJobsForMatching([job], DEFAULT_MATCHER_CONFIG);

    expect(mocks.executeStructured).toHaveBeenCalled();
    expect(mocks.getOrCreateJobAnalysis).toHaveBeenLastCalledWith(expect.objectContaining({
      extractorVersion: "job-analysis-v5",
      aiRunId: "recovered-run",
    }));
  });

  it("checks cancellation between analysis batches", async () => {
    mocks.createAICapabilityRuntime.mockResolvedValue({
      reasoningEffort: "medium",
      executeStructured: mocks.executeStructured,
    });
    mocks.executeStructured.mockResolvedValue({ runId: "run-1", output: [] });
    let stopChecks = 0;
    const shouldStop = vi.fn(async () => {
      stopChecks += 1;
      return stopChecks >= 3;
    });

    const results = await analyzeJobsForMatching(
      [job, { ...job, id: 2 }],
      { ...DEFAULT_MATCHER_CONFIG, batchSize: 1 },
      undefined,
      shouldStop
    );

    expect(results.size).toBe(0);
    expect(mocks.executeStructured).not.toHaveBeenCalled();
    expect(shouldStop).toHaveBeenCalledTimes(4);
  });

  it("executes changed analysis batches up to the configured concurrency", async () => {
    const release = Promise.withResolvers<void>();
    let active = 0;
    let maxActive = 0;
    mocks.createAICapabilityRuntime.mockResolvedValue({
      reasoningEffort: "medium",
      executeStructured: mocks.executeStructured,
    });
    mocks.executeStructured.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await release.promise;
      active -= 1;
      return { runId: "run-1", output: [] };
    });
    const jobs = [1, 2, 3].map((id) => ({ ...job, id }));

    const pending = analyzeJobsForMatching(jobs, {
      ...DEFAULT_MATCHER_CONFIG,
      batchSize: 1,
      concurrencyLimit: 2,
    });
    await vi.waitFor(() => expect(mocks.executeStructured).toHaveBeenCalledTimes(2));
    expect(maxActive).toBe(2);

    release.resolve();
    const results = await pending;

    expect(results.size).toBe(3);
    expect(mocks.executeStructured).toHaveBeenCalledTimes(3);
  });
});
