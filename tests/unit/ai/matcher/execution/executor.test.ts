import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildCandidateEvidence: vi.fn(),
  getOrCreateCandidateSnapshot: vi.fn(),
  findFreshMatch: vi.fn(),
  createMatchResult: vi.fn(),
  createAICapabilityRuntime: vi.fn(),
  fetchJobsData: vi.fn(),
  fetchProfileData: vi.fn(),
  fetchMatchingPreferences: vi.fn(),
  logMatchFailure: vi.fn(),
  persistMatchSuccess: vi.fn(),
  analyzeJobsForMatching: vi.fn(),
  enrichCandidateEvidence: vi.fn(),
  buildScoringCandidate: vi.fn(),
  scoreDeterministically: vi.fn(),
  shouldAdjudicate: vi.fn(),
  buildScoringPolicyVersion: vi.fn(),
  adjudicateMatch: vi.fn(),
  categorizeError: vi.fn(),
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
}));

vi.mock("@/lib/ai/matcher/tracking", () => ({
  fetchJobsData: mocks.fetchJobsData,
  fetchProfileData: mocks.fetchProfileData,
  fetchMatchingPreferences: mocks.fetchMatchingPreferences,
  logMatchFailure: mocks.logMatchFailure,
  persistMatchSuccess: mocks.persistMatchSuccess,
}));

vi.mock("@/lib/ai/matcher/evidence/job-analysis", () => ({
  analyzeJobsForMatching: mocks.analyzeJobsForMatching,
}));

vi.mock("@/lib/ai/matcher/evidence/candidate", () => ({
  buildScoringCandidate: mocks.buildScoringCandidate,
  enrichCandidateEvidence: mocks.enrichCandidateEvidence,
}));

vi.mock("@/lib/ai/matcher/evidence/scoring", () => ({
  scoreDeterministically: mocks.scoreDeterministically,
}));

vi.mock("@/lib/ai/matcher/evidence/adjudication", () => ({
  adjudicateMatch: mocks.adjudicateMatch,
  buildScoringPolicyVersion: mocks.buildScoringPolicyVersion,
  shouldAdjudicate: mocks.shouldAdjudicate,
}));

vi.mock("@/lib/ai/matcher/resilience", () => ({
  categorizeError: mocks.categorizeError,
  throwIfAborted: (signal?: AbortSignal) => signal?.throwIfAborted(),
}));

import { executeMatch } from "@/lib/ai/matcher/execution/executor";

const config = {
  qualityPreset: "balanced" as const,
  model: "configured-model",
  reasoningEffort: "medium",
  bulkEnabled: true,
  batchSize: 4,
  maxRetries: 2,
  concurrencyLimit: 2,
  serializeOperations: false,
  interRequestDelayMs: 0,
  timeoutMs: 30_000,
  backoffBaseDelay: 0,
  backoffMaxDelay: 0,
  circuitBreakerThreshold: 10,
  circuitBreakerResetTimeout: 60_000,
  autoMatchAfterScrape: true,
};

const candidateEvidence = {
  summary: "Backend engineer",
  skills: [{ name: "typescript", category: "backend" }],
  experience: [],
  education: [],
  preferences: {
    preferredCountry: null,
    preferredCity: null,
    acceptedLocationTypes: [],
    acceptedEmploymentTypes: [],
  },
};

const job = {
  id: 101,
  title: "Backend Engineer",
  description: "TypeScript services",
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
    mustHaveSkills: ["typescript"],
    preferredSkills: [],
    minimumExperienceYears: null,
    seniorityLevel: "mid",
    managementTrack: null,
    educationRequirements: [],
    locationConstraints: ["remote"],
    employmentType: "full-time",
    compensationText: null,
    domainKeywords: [],
    extractionConfidence: 0.9,
    ambiguities: [],
  },
};

const deterministic = {
  score: 88,
  breakdown: { mustHaveSkills: 100 },
  evidence: {
    reasons: ["1/1 must-have skills matched"],
    matchedSkills: ["typescript"],
    missingSkills: [],
    recommendations: [],
    componentEvidence: { mustHaveSkills: ["Matched: typescript"] },
  },
  confidence: 0.9,
  hardCap: null,
  availableWeight: 35,
};

describe("evidence matcher executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchMatchingPreferences.mockResolvedValue({
      acceptedLocationTypes: [],
      acceptedEmploymentTypes: [],
    });
    mocks.buildCandidateEvidence.mockReturnValue(candidateEvidence);
    mocks.enrichCandidateEvidence.mockImplementation((evidence) => evidence);
    mocks.getOrCreateCandidateSnapshot.mockResolvedValue({
      id: "candidate-1",
      fingerprint: "a".repeat(64),
      evidence: candidateEvidence,
    });
    mocks.buildScoringCandidate.mockReturnValue({ evidence: candidateEvidence });
    mocks.createAICapabilityRuntime.mockResolvedValue({
      snapshot: {
        providerRecordId: "provider-1",
        provider: "openai",
        modelId: "resolved-model",
        model: {},
      },
      reasoningEffort: "medium",
    });
    mocks.analyzeJobsForMatching.mockResolvedValue(new Map([[101, analysis]]));
    mocks.buildScoringPolicyVersion.mockReturnValue("evidence-score-v1-fixture");
    mocks.findFreshMatch.mockResolvedValue(null);
    mocks.scoreDeterministically.mockReturnValue(deterministic);
    mocks.shouldAdjudicate.mockReturnValue(false);
    mocks.createMatchResult.mockImplementation(async (input) => ({
      id: "result-1",
      ...input,
    }));
    mocks.persistMatchSuccess.mockResolvedValue(undefined);
    mocks.logMatchFailure.mockResolvedValue(undefined);
    mocks.categorizeError.mockReturnValue("unknown");
  });

  it("returns deterministic failures when profile data is missing", async () => {
    mocks.fetchJobsData.mockResolvedValue(new Map([[101, job]]));
    mocks.fetchProfileData.mockResolvedValue(null);

    const results = await executeMatch({ config, jobIds: [101], sessionId: "session-1" });

    expect(results.get(101)).toEqual(new Error("No profile found"));
    expect(mocks.analyzeJobsForMatching).not.toHaveBeenCalled();
    expect(mocks.createAICapabilityRuntime).not.toHaveBeenCalled();
  });

  it("persists the immutable evidence result and links the session log once", async () => {
    mocks.fetchJobsData.mockResolvedValue(new Map([[101, job]]));
    mocks.fetchProfileData.mockResolvedValue({
      profile: { id: 1, summary: "Backend engineer", preferredCountry: null, preferredCity: null },
      skills: [],
      experience: [],
      education: [],
    });
    const progress = vi.fn();

    const results = await executeMatch({
      config,
      jobIds: [101],
      sessionId: "session-1",
      onProgress: progress,
    });

    expect(results.get(101)).toEqual({
      score: 88,
      reasons: deterministic.evidence.reasons,
      matchedSkills: ["typescript"],
      missingSkills: [],
      recommendations: [],
    });
    expect(mocks.createMatchResult).toHaveBeenCalledWith(expect.objectContaining({
      candidateSnapshotId: "candidate-1",
      jobAnalysisId: "analysis-1",
      score: 88,
      source: "deterministic",
    }));
    expect(mocks.buildScoringPolicyVersion).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "provider-1",
      model: "resolved-model",
    }));
    expect(mocks.persistMatchSuccess).toHaveBeenCalledWith(
      "session-1",
      101,
      "result-1",
      expect.objectContaining({ score: 88 }),
      0,
      expect.any(Number),
      "deterministic"
    );
    expect(progress).toHaveBeenLastCalledWith(1, 1, 1, 0);
  });

  it("reuses a fresh immutable result without rescoring or calling a provider", async () => {
    mocks.fetchJobsData.mockResolvedValue(new Map([[101, job]]));
    mocks.fetchProfileData.mockResolvedValue({
      profile: { id: 1, summary: "Backend engineer", preferredCountry: null, preferredCity: null },
      skills: [],
      experience: [],
      education: [],
    });
    mocks.findFreshMatch.mockResolvedValue({
      id: "cached-result-1",
      score: 92,
      evidence: deterministic.evidence,
    });

    const results = await executeMatch({
      config,
      jobIds: [101],
      sessionId: "session-1",
    });

    expect(results.get(101)).toMatchObject({ score: 92 });
    expect(mocks.scoreDeterministically).not.toHaveBeenCalled();
    expect(mocks.createMatchResult).not.toHaveBeenCalled();
    expect(mocks.createAICapabilityRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.persistMatchSuccess).toHaveBeenCalledWith(
      "session-1",
      101,
      "cached-result-1",
      expect.objectContaining({ score: 92 }),
      0,
      expect.any(Number),
      "cache"
    );
  });

  it("does not begin job analysis after session cancellation", async () => {
    mocks.fetchJobsData.mockResolvedValue(new Map([[101, job]]));
    mocks.fetchProfileData.mockResolvedValue({
      profile: { id: 1, summary: "Backend engineer", preferredCountry: null, preferredCity: null },
      skills: [],
      experience: [],
      education: [],
    });

    const results = await executeMatch({
      config,
      jobIds: [101],
      shouldStop: vi.fn().mockResolvedValue(true),
    });

    expect(results.size).toBe(0);
    expect(mocks.analyzeJobsForMatching).not.toHaveBeenCalled();
  });

  it("marks a deterministic adjudication fallback as pending so it is retried", async () => {
    mocks.fetchJobsData.mockResolvedValue(new Map([[101, job]]));
    mocks.fetchProfileData.mockResolvedValue({
      profile: { id: 1, summary: "Backend engineer", preferredCountry: null, preferredCity: null },
      skills: [],
      experience: [],
      education: [],
    });
    mocks.shouldAdjudicate.mockReturnValue(true);
    mocks.createAICapabilityRuntime.mockResolvedValue({
      snapshot: {
        providerRecordId: "provider-1",
        provider: "openai",
        modelId: "configured-model",
        model: {},
      },
      reasoningEffort: "medium",
    });
    mocks.adjudicateMatch.mockRejectedValue(new Error("temporary provider failure"));

    await executeMatch({ config, jobIds: [101] });

    expect(mocks.createMatchResult).toHaveBeenCalledWith(expect.objectContaining({
      scoringPolicyVersion: "evidence-score-v1-fixture-adjudication-pending",
      source: "deterministic",
      adjudicationRunId: undefined,
    }));
    expect(mocks.createMatchResult.mock.calls[0]?.[0].evidence.reasons).toContain(
      "Deterministic fallback shown; configured adjudication will be retried"
    );
    expect(mocks.createAICapabilityRuntime).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        capability: "match_adjudication",
        resolved: expect.objectContaining({
          snapshot: expect.objectContaining({ modelId: "configured-model" }),
        }),
      })
    );
    expect(mocks.adjudicateMatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        providerId: "provider-1",
        model: "configured-model",
      }),
      undefined
    );
  });

  it("does not reuse an authoritative cache entry when concrete model resolution fails", async () => {
    mocks.fetchJobsData.mockResolvedValue(new Map([[101, job]]));
    mocks.fetchProfileData.mockResolvedValue({
      profile: { id: 1, summary: "Backend engineer", preferredCountry: null, preferredCity: null },
      skills: [],
      experience: [],
      education: [],
    });
    mocks.createAICapabilityRuntime.mockRejectedValue(new Error("provider unavailable"));

    await executeMatch({ config: { ...config, model: "" }, jobIds: [101] });

    expect(mocks.findFreshMatch).not.toHaveBeenCalled();
    expect(mocks.createMatchResult).toHaveBeenCalledWith(expect.objectContaining({
      scoringPolicyVersion: "evidence-score-v1-fixture-model-resolution-pending",
      source: "deterministic",
    }));
    expect(mocks.createMatchResult.mock.calls[0]?.[0].evidence.reasons).toContain(
      "Deterministic fallback shown; concrete model resolution will be retried"
    );
  });
});
