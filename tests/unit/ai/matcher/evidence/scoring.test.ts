import { describe, expect, it } from "vitest";

import type { CandidateEvidence, JobAnalysisEvidence, JobEvidenceInput } from "@/lib/ai/artifacts/schemas";
import {
  buildScoringCandidate,
  enrichCandidateEvidence,
  normalizeSkill,
  type ScoringCandidate,
} from "@/lib/ai/matcher/evidence/candidate";
import {
  applyAdjudicationAdjustment,
  scoreDeterministically,
} from "@/lib/ai/matcher/evidence/scoring";

function candidate(overrides: Partial<ScoringCandidate> = {}): ScoringCandidate {
  const evidence: CandidateEvidence = {
    summary: null,
    skills: [{ name: "TypeScript", category: null }],
    experience: [],
    education: [],
    preferences: {
      preferredCountry: null,
      preferredCity: null,
      acceptedLocationTypes: [],
      acceptedEmploymentTypes: [],
    },
    totalExperienceYears: null,
    experienceAsOfMonth: "2026-07",
    seniorityLevel: null,
    managementExperience: false,
    domainKeywords: [],
  };
  return {
    evidence,
    normalizedSkills: new Set([normalizeSkill("TypeScript")]),
    totalExperienceYears: null,
    seniorityLevel: null,
    managementExperience: false,
    domainKeywords: new Set(),
    ...overrides,
  };
}

function job(overrides: Partial<JobEvidenceInput> = {}): JobEvidenceInput {
  return {
    title: "Synthetic role",
    description: null,
    location: null,
    locationType: null,
    seniorityLevel: null,
    department: null,
    employmentType: null,
    compensationText: null,
    ...overrides,
  };
}

function analysis(overrides: Partial<JobAnalysisEvidence> = {}): JobAnalysisEvidence {
  return {
    mustHaveSkills: ["typescript"],
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
    ...overrides,
  };
}

describe("deterministic evidence scoring", () => {
  it("renormalizes across only the components with available evidence", () => {
    const result = scoreDeterministically(candidate(), job(), analysis());

    expect(result.score).toBe(100);
    expect(result.availableWeight).toBe(35);
    expect(result.breakdown).toMatchObject({
      mustHaveSkills: 100,
      experience: null,
      location: null,
    });
  });

  it("recognizes only conservative skill aliases", () => {
    expect(normalizeSkill("TS")).toBe("typescript");
    expect(normalizeSkill("NodeJS")).toBe("node.js");
    expect(normalizeSkill("Java")).toBe("java");
  });

  it("applies the explicit three-year experience gap cap", () => {
    const result = scoreDeterministically(
      candidate({ totalExperienceYears: 1 }),
      job(),
      analysis({ minimumExperienceYears: 5 })
    );

    expect(result.hardCap).toBe(50);
    expect(result.score).toBeLessThanOrEqual(50);
    expect(applyAdjudicationAdjustment(result, 10)).toBeLessThanOrEqual(50);
  });

  it("applies seniority and explicit onsite conflict caps", () => {
    const scoringCandidate = candidate({
      seniorityLevel: "entry",
      evidence: {
        ...candidate().evidence,
        preferences: {
          ...candidate().evidence.preferences,
          acceptedLocationTypes: ["remote"],
        },
      },
    });
    const result = scoreDeterministically(
      scoringCandidate,
      job({ seniorityLevel: "senior", locationType: "onsite" }),
      analysis({ seniorityLevel: "senior" })
    );

    expect(result.hardCap).toBe(50);
    expect(result.breakdown.seniority).toBe(20);
    expect(result.breakdown.location).toBe(0);
  });

  it("applies the onsite cap when the arrangement is accepted but geography conflicts", () => {
    const baseCandidate = candidate();
    const scoringCandidate = candidate({
      evidence: {
        ...baseCandidate.evidence,
        preferences: {
          ...baseCandidate.evidence.preferences,
          preferredCountry: "india",
          preferredCity: "bengaluru",
          acceptedLocationTypes: ["onsite"],
        },
      },
    });
    const result = scoreDeterministically(
      scoringCandidate,
      job({ location: "London, United Kingdom", locationType: "onsite" }),
      analysis()
    );

    expect(result.breakdown.location).toBe(0);
    expect(result.hardCap).toBe(50);
    expect(result.score).toBeLessThanOrEqual(50);
  });

  it("does not let a country match override a preferred-city conflict", () => {
    const baseCandidate = candidate();
    const scoringCandidate = candidate({
      evidence: {
        ...baseCandidate.evidence,
        preferences: {
          ...baseCandidate.evidence.preferences,
          preferredCountry: "india",
          preferredCity: "bengaluru",
          acceptedLocationTypes: ["onsite"],
        },
      },
    });
    const result = scoreDeterministically(
      scoringCandidate,
      job({ location: "Mumbai, India", locationType: "onsite" }),
      analysis()
    );

    expect(result.breakdown.location).toBe(0);
    expect(result.hardCap).toBe(50);
  });

  it("uses structured analysis constraints when scraper location fields are absent", () => {
    const baseCandidate = candidate();
    const scoringCandidate = candidate({
      evidence: {
        ...baseCandidate.evidence,
        preferences: {
          ...baseCandidate.evidence.preferences,
          preferredCity: "bengaluru",
          acceptedLocationTypes: ["onsite"],
        },
      },
    });
    const result = scoreDeterministically(
      scoringCandidate,
      job(),
      analysis({ locationConstraints: ["onsite", "London"] })
    );

    expect(result.breakdown.location).toBe(0);
    expect(result.hardCap).toBe(50);
  });

  it("does not treat a negated remote constraint as remote-compatible", () => {
    const baseCandidate = candidate();
    const scoringCandidate = candidate({
      evidence: {
        ...baseCandidate.evidence,
        preferences: {
          ...baseCandidate.evidence.preferences,
          preferredCity: "bengaluru",
          acceptedLocationTypes: ["remote"],
        },
      },
    });
    const result = scoreDeterministically(
      scoringCandidate,
      job(),
      analysis({
        locationConstraints: [
          "Remote work is not available; role is onsite in London",
        ],
      })
    );

    expect(result.breakdown.location).toBe(0);
    expect(result.hardCap).toBe(50);
  });

  it("scores scraper-provided remote region restrictions against geography", () => {
    const baseCandidate = candidate();
    const scoringCandidate = candidate({
      evidence: {
        ...baseCandidate.evidence,
        preferences: {
          ...baseCandidate.evidence.preferences,
          preferredCountry: "india",
          acceptedLocationTypes: ["remote"],
        },
      },
    });
    const result = scoreDeterministically(
      scoringCandidate,
      job({
        locationType: "remote",
        location: "Remote — United States only",
      }),
      analysis()
    );

    expect(result.breakdown.location).toBe(0);
    expect(result.hardCap).toBeNull();
  });

  it("scores analysis-only remote region restrictions against geography", () => {
    const baseCandidate = candidate();
    const scoringCandidate = candidate({
      evidence: {
        ...baseCandidate.evidence,
        preferences: {
          ...baseCandidate.evidence.preferences,
          preferredCountry: "india",
          acceptedLocationTypes: ["remote"],
        },
      },
    });
    const result = scoreDeterministically(
      scoringCandidate,
      job(),
      analysis({ locationConstraints: ["remote", "United States only"] })
    );

    expect(result.breakdown.location).toBe(0);
    expect(result.hardCap).toBeNull();
  });

  it("prefers an explicit analyzed onsite restriction over conflicting scraper data", () => {
    const baseCandidate = candidate();
    const scoringCandidate = candidate({
      evidence: {
        ...baseCandidate.evidence,
        preferences: {
          ...baseCandidate.evidence.preferences,
          preferredCity: "bengaluru",
          acceptedLocationTypes: ["remote"],
        },
      },
    });
    const result = scoreDeterministically(
      scoringCandidate,
      job({ locationType: "remote", location: "Remote" }),
      analysis({
        locationConstraints: [
          "Remote work is not available; role is onsite in London",
        ],
      })
    );

    expect(result.breakdown.location).toBe(0);
    expect(result.hardCap).toBe(50);
  });

  it("matches common country aliases for onsite constraints", () => {
    const baseCandidate = candidate();
    const usCandidate = candidate({
      evidence: {
        ...baseCandidate.evidence,
        preferences: {
          ...baseCandidate.evidence.preferences,
          preferredCountry: "United States",
          acceptedLocationTypes: ["onsite"],
        },
      },
    });
    const ukCandidate = candidate({
      evidence: {
        ...baseCandidate.evidence,
        preferences: {
          ...baseCandidate.evidence.preferences,
          preferredCountry: "United Kingdom",
          acceptedLocationTypes: ["onsite"],
        },
      },
    });

    expect(scoreDeterministically(
      usCandidate,
      job({ locationType: "onsite", location: "US only" }),
      analysis()
    ).breakdown.location).toBe(100);
    expect(scoreDeterministically(
      ukCandidate,
      job({ locationType: "onsite", location: "UK" }),
      analysis()
    ).breakdown.location).toBe(100);
  });

  it("treats the lower endpoint of an experience range as the minimum", () => {
    const result = scoreDeterministically(
      candidate({ totalExperienceYears: 4 }),
      job(),
      analysis({ minimumExperienceYears: 5 })
    );

    expect(result.hardCap).toBeNull();
    expect(result.breakdown.experience).toBe(75);
  });

  it("calculates non-overlapping candidate experience", () => {
    const evidence: CandidateEvidence = {
      ...candidate().evidence,
      experience: [
        {
          title: "Engineer",
          company: "Synthetic A",
          location: null,
          startDate: "2020-01-01",
          endDate: "2022-01-01",
          description: null,
          highlights: [],
        },
        {
          title: "Engineer",
          company: "Synthetic B",
          location: null,
          startDate: "2021-01-01",
          endDate: "2023-01-01",
          description: null,
          highlights: [],
        },
      ],
    };

    const enriched = enrichCandidateEvidence(
      evidence,
      new Date("2026-07-15T00:00:00.000Z")
    );
    expect(buildScoringCandidate(enriched).totalExperienceYears).toBeCloseTo(3, 1);
    expect(enriched.experienceAsOfMonth).toBe("2026-07");
  });

  it("recognizes conservative management evidence outside a role title", () => {
    const evidence: CandidateEvidence = {
      ...candidate().evidence,
      experience: [{
        title: "Software Engineer",
        company: "Synthetic Company",
        location: null,
        startDate: "2024-01-01",
        endDate: "2025-01-01",
        description: "Managed a team of 5 engineers delivering a local product.",
        highlights: [],
      }],
    };

    expect(enrichCandidateEvidence(evidence).managementExperience).toBe(true);
  });

  it("does not infer management from merely collaborating with a manager", () => {
    const evidence: CandidateEvidence = {
      ...candidate().evidence,
      experience: [{
        title: "Software Engineer",
        company: "Synthetic Company",
        location: null,
        startDate: "2024-01-01",
        endDate: "2025-01-01",
        description: "Collaborated with the product manager on delivery plans.",
        highlights: [],
      }],
    };

    expect(enrichCandidateEvidence(evidence).managementExperience).toBe(false);
  });
});
