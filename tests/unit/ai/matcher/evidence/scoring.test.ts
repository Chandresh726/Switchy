import { describe, expect, it } from "vitest";

import type {
  CandidateEvidence,
  JobAnalysisEvidence,
  JobEvidenceInput,
  JobRequirementEvidence,
} from "@/lib/ai/artifacts/schemas";
import {
  buildScoringCandidate,
  enrichCandidateEvidence,
  normalizeSkill,
  type ScoringCandidate,
} from "@/lib/ai/matcher/evidence/candidate";
import { scoreDeterministically } from "@/lib/ai/matcher/evidence/scoring";

function candidate(overrides: Partial<CandidateEvidence> = {}): ScoringCandidate {
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
    ...overrides,
  };
  return buildScoringCandidate(evidence);
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

function requirement(
  overrides: Partial<JobRequirementEvidence> = {}
): JobRequirementEvidence {
  return {
    id: "requirement:1",
    type: "technology",
    text: "TypeScript experience",
    terms: ["typescript"],
    alternatives: [],
    importance: "important",
    explicitness: "explicit",
    experienceYears: null,
    experienceScope: null,
    sourceEvidence: "TypeScript experience",
    confidence: 0.9,
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
    requirements: [requirement()],
    ...overrides,
  };
}

describe("calibrated evidence scoring", () => {
  it("does not turn one known matching component into a perfect score", () => {
    const result = scoreDeterministically(candidate(), job(), analysis());

    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.score).toBeLessThan(90);
    expect(result.evidenceCoverage).toBe(1);
    expect(result.matchBand).toBe("good");
  });

  it("treats an experience gap of six months as fully compatible", () => {
    const result = scoreDeterministically(
      candidate({ totalExperienceYears: 4.5 }),
      job(),
      analysis({
        minimumExperienceYears: 5,
        requirements: [requirement({
          type: "experience",
          text: "5 years of professional experience",
          terms: [],
          experienceYears: 5,
          experienceScope: "overall professional experience",
        })],
      })
    );

    expect(result.breakdown.experience).toBe(100);
    expect(result.hardCap).toBeNull();
  });

  it("uses a gradual penalty after the six-month tolerance", () => {
    const oneYearGap = scoreDeterministically(
      candidate({ totalExperienceYears: 4 }),
      job(),
      analysis({ minimumExperienceYears: 5 })
    );
    const threeYearGap = scoreDeterministically(
      candidate({ totalExperienceYears: 2 }),
      job(),
      analysis({ minimumExperienceYears: 5 })
    );

    expect(oneYearGap.breakdown.experience).toBe(95);
    expect(threeYearGap.breakdown.experience).toBe(55);
    expect(oneYearGap.hardCap).toBeNull();
    expect(threeYearGap.hardCap).toBeNull();
  });

  it("does not penalize technology mentioned only as contextual stack information", () => {
    const result = scoreDeterministically(
      candidate(),
      job(),
      analysis({
        requirements: [
          requirement(),
          requirement({
            id: "requirement:2",
            text: "The team also uses Rust",
            terms: ["rust"],
            importance: "contextual",
            explicitness: "implied",
          }),
        ],
      })
    );

    expect(result.requirementAssessments.find((item) =>
      item.requirementId === "requirement:2"
    )?.status).toBe("not_applicable");
    expect(result.score).toBe(scoreDeterministically(candidate(), job(), analysis()).score);
  });

  it("recognizes transferable technology families without claiming a direct match", () => {
    const result = scoreDeterministically(
      candidate({ skills: [{ name: "AWS", category: "cloud" }] }),
      job(),
      analysis({ requirements: [requirement({
        text: "Azure cloud experience",
        terms: ["azure"],
      })] })
    );

    expect(result.requirementAssessments[0]?.status).toBe("transferable_match");
    expect(result.score).toBeGreaterThan(65);
  });

  it("accepts semantic evidence that a differently named skill is equivalent", () => {
    const deterministic = scoreDeterministically(
      candidate({ skills: [{ name: "Fastify", category: "backend" }] }),
      job(),
      analysis({ requirements: [requirement({
        text: "Node.js web service development",
        terms: ["node.js"],
        explicitness: "ambiguous",
      })] })
    );
    const assessed = scoreDeterministically(
      candidate({ skills: [{ name: "Fastify", category: "backend" }] }),
      job(),
      analysis({ requirements: [requirement({
        text: "Node.js web service development",
        terms: ["node.js"],
        explicitness: "ambiguous",
      })] }),
      [{
        requirementId: "requirement:1",
        status: "equivalent_match",
        confidence: 0.8,
        evidenceReferences: ["skill:0"],
        rationale: "Fastify demonstrates Node.js service development.",
      }]
    );

    expect(deterministic.requirementAssessments[0]?.status).toBe("unknown");
    expect(assessed.requirementAssessments[0]?.status).toBe("equivalent_match");
    expect(assessed.score).toBeGreaterThan(deterministic.score);
  });

  it("does not let a low-confidence semantic label override deterministic evidence", () => {
    const scoringCandidate = candidate({ skills: [{ name: "Fastify", category: "backend" }] });
    const analyzed = analysis({ requirements: [requirement({
      text: "Node.js web service development",
      terms: ["node.js"],
      explicitness: "ambiguous",
    })] });
    const deterministic = scoreDeterministically(scoringCandidate, job(), analyzed);
    const lowConfidence = scoreDeterministically(scoringCandidate, job(), analyzed, [{
      requirementId: "requirement:1",
      status: "equivalent_match",
      confidence: 0.01,
      evidenceReferences: ["skill:0"],
      rationale: "Weakly inferred equivalence.",
    }]);

    expect(lowConfidence.score).toBe(deterministic.score);
    expect(lowConfidence.confidence).toBe(deterministic.confidence);
    expect(lowConfidence.requirementAssessments[0]?.status).toBe("unknown");
  });

  it("weights accepted semantic labels by their confidence", () => {
    const scoringCandidate = candidate({ skills: [{ name: "Fastify", category: "backend" }] });
    const analyzed = analysis({ requirements: [requirement({
      text: "Node.js web service development",
      terms: ["node.js"],
      explicitness: "ambiguous",
    })] });
    const semantic = (confidence: number) => scoreDeterministically(
      scoringCandidate,
      job(),
      analyzed,
      [{
        requirementId: "requirement:1",
        status: "equivalent_match",
        confidence,
        evidenceReferences: ["skill:0"],
        rationale: "Fastify demonstrates related service development.",
      }]
    );
    const medium = semantic(0.55);
    const high = semantic(0.95);

    expect(high.score).toBeGreaterThan(medium.score);
    expect(high.confidence).toBeGreaterThan(medium.confidence);
    expect(medium.evidenceCoverage).toBeLessThan(high.evidenceCoverage);
  });

  it("uses semantic reasoning for scoped experience instead of total years", () => {
    const scoringCandidate = candidate({
      totalExperienceYears: 10,
      skills: [{ name: "React", category: "frontend" }],
      experience: [{
        title: "Frontend Engineer",
        company: "Synthetic Company",
        location: null,
        startDate: "2019-01-01",
        endDate: "2025-01-01",
        description: "Built React applications.",
        highlights: [],
      }],
    });
    const scoped = analysis({
      minimumExperienceYears: null,
      requirements: [requirement({
        type: "experience",
        text: "Five years building React applications",
        terms: ["react"],
        experienceYears: 5,
        experienceScope: "building React applications",
      })],
    });
    const deterministic = scoreDeterministically(scoringCandidate, job(), scoped);
    const assessed = scoreDeterministically(scoringCandidate, job(), scoped, [{
      requirementId: "requirement:1",
      status: "equivalent_match",
      confidence: 0.9,
      evidenceReferences: ["experience:0"],
      rationale: "The candidate demonstrates equivalent scoped React experience.",
    }]);

    expect(deterministic.requirementAssessments[0]?.status).toBe("partial_match");
    expect(assessed.score).toBeGreaterThan(deterministic.score);
  });

  it("keeps major experience and seniority mismatches out of top bands", () => {
    const experienceMismatch = scoreDeterministically(
      candidate({ totalExperienceYears: 1, seniorityLevel: "mid" }),
      job({ seniorityLevel: "mid" }),
      analysis({ minimumExperienceYears: 5, seniorityLevel: "mid" })
    );
    const seniorityMismatch = scoreDeterministically(
      candidate({ totalExperienceYears: 4, seniorityLevel: "entry" }),
      job({ seniorityLevel: "senior" }),
      analysis({ minimumExperienceYears: 3, seniorityLevel: "senior" })
    );

    expect(["possible", "stretch", "low"]).toContain(experienceMismatch.matchBand);
    expect(["possible", "stretch", "low"]).toContain(seniorityMismatch.matchBand);
    expect(experienceMismatch.hardCap).toBeNull();
    expect(seniorityMismatch.hardCap).toBeNull();
  });

  it("does not treat preferred management experience as a required seniority gate", () => {
    const result = scoreDeterministically(candidate(), job(), analysis({
      managementTrack: true,
      requirements: [requirement({
        type: "management",
        text: "People management is a plus",
        terms: [],
        importance: "preferred",
      })],
    }));

    expect(result.breakdown.seniority).toBeNull();
  });

  it("reports location conflicts separately without capping role fit", () => {
    const scoringCandidate = candidate({
      preferences: {
        preferredCountry: "india",
        preferredCity: "bengaluru",
        acceptedLocationTypes: ["onsite"],
        acceptedEmploymentTypes: [],
      },
    });
    const compatibleRole = scoreDeterministically(scoringCandidate, job(), analysis());
    const locationConflict = scoreDeterministically(
      scoringCandidate,
      job({ location: "London, United Kingdom", locationType: "onsite" }),
      analysis()
    );

    expect(locationConflict.score).toBe(compatibleRole.score);
    expect(locationConflict.constraints).toContainEqual(expect.objectContaining({
      type: "location",
      status: "conflict",
      severity: "blocking",
    }));
  });

  it("preserves distinct semantic constraints and treats partial proof as unknown", () => {
    const result = scoreDeterministically(
      candidate({
        preferences: {
          preferredCountry: null,
          preferredCity: null,
          acceptedLocationTypes: ["remote"],
          acceptedEmploymentTypes: [],
        },
      }),
      job({ locationType: "remote" }),
      analysis({ requirements: [
        requirement({
          id: "requirement:1",
          type: "location",
          text: "Must reside in Canada",
          terms: ["canada"],
          importance: "critical",
        }),
        requirement({
          id: "requirement:2",
          type: "license",
          text: "Professional license",
          terms: ["license"],
          importance: "critical",
        }),
      ] }),
      [{
        requirementId: "requirement:1",
        status: "missing",
        confidence: 0.9,
        evidenceReferences: [],
        rationale: "Candidate location does not meet the residency requirement.",
      }, {
        requirementId: "requirement:2",
        status: "partial_match",
        confidence: 0.9,
        evidenceReferences: ["skill:0"],
        rationale: "Related evidence exists but the license is not verified.",
      }]
    );

    expect(result.constraints.filter((constraint) => constraint.type === "location"))
      .toHaveLength(2);
    expect(result.constraints).toContainEqual(expect.objectContaining({
      type: "location",
      status: "conflict",
      severity: "blocking",
    }));
    expect(result.constraints).toContainEqual(expect.objectContaining({
      type: "license",
      status: "unknown",
      severity: "blocking",
    }));
  });

  it("treats explicit missing critical skills as gaps but ambiguous evidence as unknown", () => {
    const critical = scoreDeterministically(
      candidate({ skills: [{ name: "Python", category: null }] }),
      job(),
      analysis({ requirements: [requirement({ importance: "critical" })] })
    );
    const ambiguous = scoreDeterministically(
      candidate({ skills: [{ name: "Python", category: null }] }),
      job(),
      analysis({ requirements: [requirement({ explicitness: "ambiguous" })] })
    );

    expect(critical.requirementAssessments[0]?.status).toBe("missing");
    expect(ambiguous.requirementAssessments[0]?.status).toBe("unknown");
    expect(ambiguous.matchBand).toBe("insufficient_evidence");
  });

  it("recognizes conservative skill aliases", () => {
    expect(normalizeSkill("TS")).toBe("typescript");
    expect(normalizeSkill("NodeJS")).toBe("node.js");
    expect(normalizeSkill("Java")).toBe("java");
  });

  it("calculates non-overlapping candidate experience", () => {
    const evidence = candidate().evidence;
    const enriched = enrichCandidateEvidence({
      ...evidence,
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
    }, new Date("2026-07-15T00:00:00.000Z"));

    expect(buildScoringCandidate(enriched).totalExperienceYears).toBeCloseTo(3, 1);
  });

  it("derives evidence references from experience descriptions", () => {
    const scoringCandidate = candidate({
      skills: [],
      experience: [{
        title: "Backend Engineer",
        company: "Synthetic Company",
        location: null,
        startDate: "2024-01-01",
        endDate: "2025-01-01",
        description: "Built production TypeScript services.",
        highlights: [],
      }],
    });
    const result = scoreDeterministically(scoringCandidate, job(), analysis());

    expect(result.requirementAssessments[0]).toMatchObject({
      status: "direct_match",
      evidenceReferences: ["experience:0"],
    });
  });

  it("bounds candidate evidence before semantic ranking or serialization", () => {
    const scoringCandidate = candidate({
      summary: "S".repeat(100_000),
      experience: [{
        title: "Backend Engineer",
        company: "Synthetic Company",
        location: null,
        startDate: "2024-01-01",
        endDate: "2025-01-01",
        description: "D".repeat(100_000),
        highlights: ["H".repeat(100_000)],
      }],
    });

    expect(scoringCandidate.evidenceItems.length).toBeGreaterThan(0);
    expect(scoringCandidate.evidenceItems.every((item) => item.text.length <= 2_000))
      .toBe(true);
  });
});
