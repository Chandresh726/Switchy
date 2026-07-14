import { describe, expect, it, vi } from "vitest";

import {
  adjudicateMatch,
  buildScoringPolicyVersion,
  shouldAdjudicate,
} from "@/lib/ai/matcher/evidence/adjudication";
import { DEFAULT_MATCHER_CONFIG } from "@/lib/ai/matcher/types";

function result(score: number, confidence: number) {
  return {
    score,
    confidence,
    breakdown: {},
    evidence: {
      reasons: [],
      matchedSkills: [],
      missingSkills: [],
      recommendations: [],
      componentEvidence: {},
    },
    hardCap: null,
    availableWeight: 50,
  };
}

describe("selective match adjudication", () => {
  it("uses the exact economy, balanced, and quality thresholds", () => {
    expect(shouldAdjudicate("economy", result(90, 0.39))).toBe(true);
    expect(shouldAdjudicate("economy", result(60, 0.4))).toBe(false);
    expect(shouldAdjudicate("balanced", result(50, 0.74))).toBe(true);
    expect(shouldAdjudicate("balanced", result(76, 0.3))).toBe(false);
    expect(shouldAdjudicate("quality", result(90, 0.89))).toBe(true);
    expect(shouldAdjudicate("quality", result(85, 0.95))).toBe(true);
    expect(shouldAdjudicate("quality", result(86, 0.95))).toBe(false);
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
    expect(buildScoringPolicyVersion(base)).not.toBe(
      buildScoringPolicyVersion({ ...base, providerId: "provider-b" })
    );
    expect(buildScoringPolicyVersion(base, "extractor-v1")).not.toBe(
      buildScoringPolicyVersion(base, "extractor-v2")
    );
  });

  it("cannot adjust above a deterministic hard cap and requires real evidence references", async () => {
    const executeStructured = vi.fn().mockImplementation(async (input) => {
      expect(input.validate({
        adjustment: 10,
        evidenceReferences: ["experience"],
        rationale: "Borderline evidence",
      })).toBe(true);
      expect(input.validate({
        adjustment: 10,
        evidenceReferences: ["invented"],
        rationale: "Unsupported",
      })).toBe(false);
      return {
        output: {
          adjustment: 10,
          evidenceReferences: ["experience"],
          rationale: "Borderline evidence",
        },
        runId: "run-1",
        attempts: 2,
      };
    });
    const runtime = {
      reasoningEffort: "medium",
      executeStructured,
    } as never;
    const deterministic = {
      ...result(50, 0.5),
      hardCap: 50,
      evidence: {
        ...result(50, 0.5).evidence,
        componentEvidence: { experience: ["Candidate: 1 year", "Required: 5 years"] },
      },
    };
    const candidate = {
      evidence: {
        summary: null,
        skills: [],
        experience: [],
        education: [],
        preferences: {
          preferredCountry: null,
          preferredCity: null,
          acceptedLocationTypes: [],
          acceptedEmploymentTypes: [],
        },
        totalExperienceYears: 1,
        experienceAsOfMonth: "2026-07",
        seniorityLevel: "entry" as const,
        managementExperience: false,
        domainKeywords: [],
      },
      normalizedSkills: new Set<string>(),
      totalExperienceYears: 1,
      seniorityLevel: "entry" as const,
      managementExperience: false,
      domainKeywords: new Set<string>(),
    };
    const analyzed = {
      job: { id: 1 },
      jobEvidence: {
        title: "Synthetic role",
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
        mustHaveSkills: [],
        preferredSkills: [],
        minimumExperienceYears: 5,
        seniorityLevel: null,
        managementTrack: null,
        educationRequirements: [],
        locationConstraints: [],
        employmentType: null,
        compensationText: null,
        domainKeywords: [],
        extractionConfidence: 0.5,
        ambiguities: [],
      },
    } as never;

    const adjudicated = await adjudicateMatch(
      runtime,
      candidate,
      analyzed,
      deterministic,
      DEFAULT_MATCHER_CONFIG
    );

    expect(adjudicated).toMatchObject({ score: 50, adjustment: 10, attempts: 2 });
  });
});
