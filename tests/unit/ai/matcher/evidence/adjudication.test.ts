import { describe, expect, it, vi } from "vitest";

import { buildScoringCandidate } from "@/lib/ai/matcher/evidence/candidate";
import {
  adjudicateMatch,
  buildScoringPolicyVersion,
  shouldAdjudicate,
} from "@/lib/ai/matcher/evidence/adjudication";
import type { DeterministicScoreResult } from "@/lib/ai/matcher/evidence/scoring";
import { DEFAULT_MATCHER_CONFIG } from "@/lib/ai/matcher/types";

function result(
  status: "direct_match" | "partial_match" | "missing" | "unknown",
  importance: "critical" | "important" | "preferred" = "important",
  confidence = 0.8
): DeterministicScoreResult {
  return {
    score: 70,
    roleFitScore: 70,
    matchBand: "good",
    confidence,
    evidenceCoverage: 0.6,
    extractionConfidence: 0.8,
    breakdown: {},
    evidence: {
      reasons: [],
      matchedSkills: [],
      missingSkills: [],
      recommendations: [],
      componentEvidence: {},
      summary: "",
      matchBand: "good",
      roleFitScore: 70,
      evidenceCoverage: 0.6,
      extractionConfidence: 0.8,
      constraints: [],
      requirementAssessments: [],
    },
    constraints: [],
    requirementAssessments: [{
      requirementId: "requirement:1",
      status,
      confidence,
      evidenceReferences: [],
      rationale: "Synthetic assessment",
      importance,
      type: "technology",
      text: "TypeScript",
      terms: ["typescript"],
    }],
    hardCap: null,
    availableWeight: 60,
  };
}

describe("semantic match assessment selection", () => {
  it("reviews unresolved requirements by preset instead of numeric score windows", () => {
    expect(shouldAdjudicate("economy", result("missing", "critical"))).toBe(true);
    expect(shouldAdjudicate("economy", result("unknown", "important", 0.8))).toBe(false);
    expect(shouldAdjudicate("balanced", result("unknown", "important"))).toBe(true);
    expect(shouldAdjudicate("balanced", result("partial_match", "important"))).toBe(true);
    expect(shouldAdjudicate("balanced", result("direct_match", "important", 0.8))).toBe(false);
    expect(shouldAdjudicate("quality", result("direct_match"))).toBe(true);
  });

  it("changes the policy version when model policy changes", () => {
    const base = {
      qualityPreset: "balanced" as const,
      model: "model-a",
      reasoningEffort: "medium",
      providerId: "provider-a",
    };

    expect(buildScoringPolicyVersion(base)).not.toBe(
      buildScoringPolicyVersion({ ...base, model: "model-b" })
    );
    expect(buildScoringPolicyVersion(base)).not.toBe(
      buildScoringPolicyVersion({ ...base, qualityPreset: "quality" })
    );
    expect(buildScoringPolicyVersion(base, "extractor-v1")).not.toBe(
      buildScoringPolicyVersion(base, "extractor-v2")
    );
  });

  it("requires one assessment per requirement with real candidate evidence references", async () => {
    const executeStructured = vi.fn().mockImplementation(async (input) => {
      const prompt = JSON.parse(input.prompt) as {
        candidate: { evidence: Array<{ id: string }>; skills?: string[] };
        deterministic: { assessments: Array<{ evidenceReferences: string[] }> };
      };
      expect(input.prompt.length).toBeLessThanOrEqual(80_000);
      expect(prompt.candidate.evidence).toHaveLength(80);
      expect(prompt.candidate.evidence.some((item) => item.id === "experience:0")).toBe(true);
      expect(prompt.candidate.skills).toBeUndefined();
      const suppliedEvidenceIds = new Set(prompt.candidate.evidence.map((item) => item.id));
      expect(prompt.deterministic.assessments.every((assessment) =>
        assessment.evidenceReferences.every((reference) =>
          reference.startsWith("candidate:") || suppliedEvidenceIds.has(reference)
        )
      )).toBe(true);
      const valid = {
        assessments: [{
          requirementId: "requirement:1",
          status: "equivalent_match",
          confidence: 0.85,
          evidenceReferences: ["experience:0"],
          rationale: "Production service evidence supports the underlying competency.",
        }],
        summary: "The candidate has equivalent backend experience.",
      };
      expect(input.validate(valid)).toBe(true);
      expect(input.validate({
        ...valid,
        assessments: [{
          ...valid.assessments[0],
          evidenceReferences: ["invented"],
        }],
      })).toBe(false);
      expect(input.validate({
        ...valid,
        assessments: [{
          ...valid.assessments[0],
          evidenceReferences: ["candidate:preferences"],
        }],
      })).toBe(false);
      return { output: valid, runId: "run-1", attempts: 1 };
    });
    const runtime = {
      reasoningEffort: "medium",
      executeStructured,
    } as never;
    const candidate = buildScoringCandidate({
      summary: null,
      skills: Array.from({ length: 100 }, (_, index) => ({
        name: `Synthetic skill ${index}`,
        category: null,
      })),
      experience: [{
        title: "Backend Engineer",
        company: "Synthetic Company",
        location: null,
        startDate: "2024-01-01",
        endDate: "2025-01-01",
        description: "Built production services with Fastify.",
        highlights: [],
      }],
      education: [],
      preferences: {
        preferredCountry: null,
        preferredCity: null,
        acceptedLocationTypes: [],
        acceptedEmploymentTypes: [],
      },
      totalExperienceYears: 1,
      experienceAsOfMonth: "2026-07",
      seniorityLevel: "mid",
      managementExperience: false,
      domainKeywords: [],
    });
    const analyzed = {
      job: { id: 1 },
      jobEvidence: {
        title: "Backend Engineer",
        description: null,
        location: null,
        locationType: null,
        seniorityLevel: null,
        department: null,
        employmentType: null,
        compensationText: null,
      },
      jobFingerprint: "a".repeat(64),
      analysis: {
        mustHaveSkills: ["node.js"],
        preferredSkills: [],
        minimumExperienceYears: null,
        seniorityLevel: null,
        managementTrack: null,
        educationRequirements: [],
        locationConstraints: [],
        employmentType: null,
        compensationText: null,
        domainKeywords: [],
        extractionConfidence: 0.8,
        ambiguities: [],
        requirements: [{
          id: "requirement:1",
          type: "competency" as const,
          text: "Node.js backend services",
          terms: ["node.js"],
          alternatives: [],
          importance: "important" as const,
          explicitness: "ambiguous" as const,
          experienceYears: null,
          experienceScope: null,
          sourceEvidence: "Build Node.js backend services",
          confidence: 0.8,
        }],
      },
    } as never;

    const deterministic = result("unknown");
    deterministic.requirementAssessments[0]!.evidenceReferences = [
      "experience:0",
      ...Array.from({ length: 100 }, (_, index) => `skill:${index}`),
    ];
    const assessed = await adjudicateMatch(
      runtime,
      candidate,
      analyzed,
      deterministic,
      DEFAULT_MATCHER_CONFIG
    );

    expect(assessed).toMatchObject({
      runId: "run-1",
      attempts: 1,
      summary: "The candidate has equivalent backend experience.",
    });
    expect(assessed.assessments[0]?.status).toBe("equivalent_match");
  });

  it("requires dated, scoped experience evidence for strong duration claims", async () => {
    const executeStructured = vi.fn().mockImplementation(async (input) => {
      const assessment = (status: string, evidenceReferences: string[]) => ({
        assessments: [{
          requirementId: "requirement:1",
          status,
          confidence: 0.9,
          evidenceReferences,
          rationale: "Synthetic scoped-duration assessment.",
        }],
        summary: "Synthetic summary.",
      });
      expect(input.validate(assessment("direct_match", ["skill:0"]))).toBe(false);
      expect(input.validate(assessment("direct_match", ["experience:0"]))).toBe(false);
      expect(input.validate(assessment("direct_match", ["experience:2"]))).toBe(false);
      expect(input.validate(assessment("direct_match", ["experience:3"]))).toBe(true);
      expect(input.validate(assessment("direct_match", ["experience:4"]))).toBe(true);
      expect(input.validate(assessment("direct_match", ["candidate:total_experience"]))).toBe(false);
      expect(input.validate(assessment("partial_match", ["skill:0"]))).toBe(true);
      expect(input.validate(assessment("not_applicable", []))).toBe(false);
      const valid = assessment("equivalent_match", ["experience:1"]);
      expect(input.validate(valid)).toBe(true);
      return { output: valid, runId: "run-scoped", attempts: 1 };
    });
    const candidate = buildScoringCandidate({
      summary: null,
      skills: [{ name: "React", category: "frontend" }],
      experience: [{
        title: "Frontend Engineer",
        company: "Short Fixture",
        location: null,
        startDate: "2024-01-01",
        endDate: "2025-01-01",
        description: "Built React applications.",
        highlights: [],
      }, {
        title: "React Frontend Engineer",
        company: "Long Fixture",
        location: null,
        startDate: "2019-01-01",
        endDate: "2025-01-01",
        description: "Built and maintained React applications.",
        highlights: [],
      }, {
        title: "Frontend Engineer",
        company: "Ambiguous Long Fixture",
        location: null,
        startDate: "2018-01-01",
        endDate: "2025-01-01",
        description: "Built platform features, including a recent React application.",
        highlights: [],
      }, {
        title: "Frontend Engineer",
        company: "Punctuation Fixture",
        location: null,
        startDate: "2019-01-01",
        endDate: "2025-01-01",
        description: "Built React, TypeScript, and CSS throughout this role.",
        highlights: [],
      }, {
        title: "Frontend Engineer",
        company: "Explicit Years Fixture",
        location: null,
        startDate: "2019-01-01",
        endDate: "2025-01-01",
        description: "6 years of React.",
        highlights: [],
      }],
      education: [],
      preferences: {
        preferredCountry: null,
        preferredCity: null,
        acceptedLocationTypes: [],
        acceptedEmploymentTypes: [],
      },
      totalExperienceYears: 6,
      experienceAsOfMonth: "2026-07",
      seniorityLevel: "senior",
      managementExperience: false,
      domainKeywords: [],
    });
    const analyzed = {
      job: { id: 1 },
      jobEvidence: {
        title: "Frontend Engineer",
        description: null,
        location: null,
        locationType: null,
        seniorityLevel: null,
        department: null,
        employmentType: null,
        compensationText: null,
      },
      jobFingerprint: "b".repeat(64),
      analysis: {
        mustHaveSkills: ["react"],
        preferredSkills: [],
        minimumExperienceYears: null,
        seniorityLevel: null,
        managementTrack: null,
        educationRequirements: [],
        locationConstraints: [],
        employmentType: null,
        compensationText: null,
        domainKeywords: [],
        extractionConfidence: 0.9,
        ambiguities: [],
        requirements: [{
          id: "requirement:1",
          type: "experience" as const,
          text: "Five years building React applications",
          terms: ["react"],
          alternatives: [],
          importance: "important" as const,
          explicitness: "explicit" as const,
          experienceYears: 5,
          experienceScope: "building React applications",
          sourceEvidence: "Five years building React applications",
          confidence: 0.9,
        }],
      },
    } as never;
    const deterministic = result("partial_match");
    deterministic.requirementAssessments[0] = {
      ...deterministic.requirementAssessments[0]!,
      type: "experience",
      text: "Five years building React applications",
      terms: ["react"],
      experienceYears: 5,
      experienceScope: "building React applications",
      evidenceReferences: ["skill:0"],
    };

    const assessed = await adjudicateMatch(
      { reasoningEffort: "medium", executeStructured } as never,
      candidate,
      analyzed,
      deterministic,
      DEFAULT_MATCHER_CONFIG
    );

    expect(assessed.assessments[0]?.evidenceReferences).toEqual(["experience:1"]);
  });
});
