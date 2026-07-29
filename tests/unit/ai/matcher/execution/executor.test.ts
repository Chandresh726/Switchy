import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildCandidateEvidence: vi.fn(),
  getOrCreateCandidateSnapshot: vi.fn(),
  findFreshMatch: vi.fn(),
  createMatchResult: vi.fn(),
  createAICapabilityRuntime: vi.fn(),
  getAIExecutionErrorContext: vi.fn(() => ({})),
  fetchJobsData: vi.fn(),
  fetchProfileData: vi.fn(),
  logMatchFailure: vi.fn(),
  persistMatchSuccess: vi.fn(),
  markJobAnalysisReady: vi.fn(),
  markJobAnalysisStarted: vi.fn(),
  markJobMatchStarted: vi.fn(),
  analyzeJobsForMatching: vi.fn(),
  buildJobAnalysisVersion: vi.fn(),
  enrichCandidateEvidence: vi.fn(),
  buildMatchPolicyVersion: vi.fn(),
  evaluateMatchWithAI: vi.fn(),
  buildPersistedMatchArtifacts: vi.fn(),
}));

vi.mock("@/lib/ai/artifacts", () => ({
  artifactRepository: {
    getOrCreateCandidateSnapshot: mocks.getOrCreateCandidateSnapshot,
    findFreshMatch: mocks.findFreshMatch,
    createMatchResult: mocks.createMatchResult,
  },
  buildCandidateEvidence: mocks.buildCandidateEvidence,
}));

vi.mock("@/lib/ai/runtime", () => ({
  createAICapabilityRuntime: mocks.createAICapabilityRuntime,
  getAIExecutionErrorContext: mocks.getAIExecutionErrorContext,
}));

vi.mock("@/lib/ai/matcher/tracking", () => ({
  fetchJobsData: mocks.fetchJobsData,
  fetchProfileData: mocks.fetchProfileData,
  logMatchFailure: mocks.logMatchFailure,
  persistMatchSuccess: mocks.persistMatchSuccess,
  markJobAnalysisReady: mocks.markJobAnalysisReady,
  markJobAnalysisStarted: mocks.markJobAnalysisStarted,
  markJobMatchStarted: mocks.markJobMatchStarted,
}));

vi.mock("@/lib/ai/matcher/evidence/job-analysis", () => ({
  analyzeJobsForMatching: mocks.analyzeJobsForMatching,
  buildJobAnalysisVersion: mocks.buildJobAnalysisVersion,
}));

vi.mock("@/lib/ai/matcher/evidence/candidate", () => ({
  enrichCandidateEvidence: mocks.enrichCandidateEvidence,
}));

vi.mock("@/lib/ai/matcher/evidence/ai-match", () => ({
  buildMatchPolicyVersion: mocks.buildMatchPolicyVersion,
  evaluateMatchWithAI: mocks.evaluateMatchWithAI,
  buildPersistedMatchArtifacts: mocks.buildPersistedMatchArtifacts,
}));

import { executeMatch } from "@/lib/ai/matcher/execution/executor";
import type { MatcherConfig } from "@/lib/ai/matcher/types";

const config: MatcherConfig = {
  jobAnalysisProviderId: "analysis-provider",
  jobAnalysisModel: "analysis-model",
  jobAnalysisReasoningEffort: "high",
  providerId: "match-provider",
  model: "match-model",
  reasoningEffort: "medium",
  batchSize: 4,
  maxRetries: 2,
  concurrencyLimit: 2,
  timeoutMs: 30_000,
  backoffBaseDelay: 0,
  backoffMaxDelay: 0,
  autoMatchAfterScrape: true,
};

const candidateEvidence = {
  summary: "Backend engineer",
  skills: [{ name: "TypeScript", category: "backend" }],
  experience: [],
  education: [],
  preferences: {
    preferredCountry: null,
    preferredCity: null,
  },
  totalExperienceYears: 4,
  experienceAsOfMonth: "2026-07",
  seniorityLevel: null,
  managementExperience: false,
  domainKeywords: [],
};

const job = {
  id: 101,
  title: "Backend Engineer",
  description: "Build TypeScript services",
  location: null,
  locationType: "remote",
  salary: null,
  department: "engineering",
  employmentType: "full-time",
  seniorityLevel: "mid",
};

const analysis = {
  job,
  jobEvidence: {
    title: job.title,
    description: job.description,
    location: null,
    locationType: "remote",
    seniorityLevel: "mid",
    department: "engineering",
    employmentType: "full-time",
    compensationText: null,
  },
  jobFingerprint: "b".repeat(64),
  jobAnalysisId: "analysis-1",
  analysis: {
    summary: "Backend role building TypeScript services.",
    requirements: [],
  },
};

const evidence = {
  summary: "Strong fit",
  reasoning: [{
    type: "match" as const,
    text: "Strong responsibilities match",
    candidateEvidenceReferences: ["summary:1"],
    jobRequirementReferences: [],
  }],
  matchedSkills: ["TypeScript"],
};

describe("AI-only matcher executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchJobsData.mockResolvedValue(new Map([[101, job]]));
    mocks.fetchProfileData.mockResolvedValue({
      profile: { id: 1, summary: "Backend engineer", preferredCountry: null, preferredCity: null },
      skills: [],
      experience: [],
      education: [],
    });
    mocks.buildCandidateEvidence.mockReturnValue(candidateEvidence);
    mocks.enrichCandidateEvidence.mockReturnValue(candidateEvidence);
    mocks.getOrCreateCandidateSnapshot.mockResolvedValue({
      id: "candidate-1",
      fingerprint: "a".repeat(64),
      evidence: candidateEvidence,
    });
    mocks.createAICapabilityRuntime.mockImplementation(async ({ capability }) => ({
      capability,
      snapshot: {
        providerRecordId: capability === "job_analysis" ? "analysis-provider" : "match-provider",
        provider: "openai",
        modelId: capability === "job_analysis" ? "analysis-model" : "match-model",
        backendKind: "ai_sdk",
      },
      reasoningEffort: capability === "job_analysis" ? "high" : "medium",
    }));
    mocks.analyzeJobsForMatching.mockResolvedValue(new Map([[101, analysis]]));
    mocks.buildJobAnalysisVersion.mockReturnValue("analysis-policy-v1");
    mocks.buildMatchPolicyVersion.mockReturnValue("ai-match-policy-v1-fixture");
    mocks.findFreshMatch.mockResolvedValue(null);
    mocks.evaluateMatchWithAI.mockResolvedValue({
      outcome: { score: 90 },
      runId: "match-run-1",
      attempts: 1,
    });
    mocks.buildPersistedMatchArtifacts.mockReturnValue({
      breakdown: { responsibilities: 90 },
      evidence: structuredClone(evidence),
    });
    mocks.createMatchResult.mockImplementation(async (input) => ({
      id: "result-1",
      ...input,
    }));
  });

  it("does not resolve a model when the profile is missing", async () => {
    mocks.fetchProfileData.mockResolvedValue(null);
    const results = await executeMatch({ config, jobIds: [101], sessionId: "session-1" });

    expect(results.get(101)).toMatchObject({ type: "missing_profile" });
    expect(mocks.createAICapabilityRuntime).not.toHaveBeenCalled();
    expect(mocks.createMatchResult).not.toHaveBeenCalled();
  });

  it("uses separate analysis and match runtimes and persists only the AI score", async () => {
    const results = await executeMatch({ config, jobIds: [101], sessionId: "session-1" });

    expect(mocks.createAICapabilityRuntime).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ capability: "job_analysis" })
    );
    expect(mocks.createAICapabilityRuntime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ capability: "match_evaluation" })
    );
    expect(mocks.createMatchResult).toHaveBeenCalledWith(expect.objectContaining({
      source: "ai",
      score: 90,
      matchRunId: "match-run-1",
      matchPolicyVersion: "ai-match-policy-v1-fixture",
    }));
    expect(results.get(101)).toMatchObject({ score: 90 });
  });

  it("reuses a fresh AI result without another final match call", async () => {
    mocks.findFreshMatch.mockResolvedValue({ id: "cached", score: 86, evidence });

    const results = await executeMatch({ config, jobIds: [101], sessionId: "session-1" });

    expect(results.get(101)).toMatchObject({ score: 86 });
    expect(mocks.evaluateMatchWithAI).not.toHaveBeenCalled();
    expect(mocks.createMatchResult).not.toHaveBeenCalled();
  });

  it("creates no match result when job analysis fails", async () => {
    mocks.analyzeJobsForMatching.mockResolvedValue(new Map());

    const results = await executeMatch({ config, jobIds: [101], sessionId: "session-1" });

    expect(results.get(101)).toBeInstanceOf(Error);
    expect(mocks.evaluateMatchWithAI).not.toHaveBeenCalled();
    expect(mocks.createMatchResult).not.toHaveBeenCalled();
    expect(mocks.logMatchFailure).toHaveBeenCalled();
  });

  it("starts final matching as soon as an analysis becomes ready", async () => {
    let releaseAnalysis!: () => void;
    const analysisBlocked = new Promise<void>((resolve) => {
      releaseAnalysis = resolve;
    });
    mocks.analyzeJobsForMatching.mockImplementation(async (
      _jobs,
      _config,
      _signal,
      _shouldStop,
      _runtime,
      callbacks
    ) => {
      await callbacks.onReady(analysis, "generated");
      await analysisBlocked;
      return new Map([[101, analysis]]);
    });

    const execution = executeMatch({ config, jobIds: [101], sessionId: "session-1" });
    await vi.waitFor(() => expect(mocks.evaluateMatchWithAI).toHaveBeenCalledOnce());
    releaseAnalysis();
    await execution;
  });
});
