import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { normalizeSkill, type ScoringCandidate } from "@/lib/ai/matcher/evidence/candidate";
import { scoreDeterministically } from "@/lib/ai/matcher/evidence/scoring";

const NullableString = z.string().nullable();
const ScenarioSchema = z.object({
  id: z.string(),
  candidate: z.object({
    skills: z.array(z.string()),
    years: z.number().nullable(),
    seniority: z.enum(["entry", "mid", "senior", "lead", "manager", "director", "executive"]).nullable(),
    locations: z.array(z.string()),
    employment: z.array(z.string()),
  }),
  job: z.object({
    locationType: NullableString,
    employmentType: NullableString,
    seniorityLevel: NullableString,
  }),
  analysis: z.object({
    must: z.array(z.string()),
    preferred: z.array(z.string()),
    years: z.number().nullable(),
    seniority: NullableString,
    confidence: z.number().min(0).max(1),
  }),
  expected: z.object({
    min: z.number(),
    max: z.number(),
    hardCap: z.number().nullable(),
  }),
});
const CorpusSchema = z.object({
  scenarios: z.array(ScenarioSchema),
  pairwise: z.array(z.tuple([z.string(), z.string()])),
});

const corpus = CorpusSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "tests/fixtures/ai/matcher-evaluation.json"),
  "utf8"
)));

function evaluateScenario(scenario: z.infer<typeof ScenarioSchema>) {
  const evidence = {
    summary: null,
    skills: scenario.candidate.skills.map((name) => ({ name, category: null })),
    experience: [],
    education: [],
    preferences: {
      preferredCountry: null,
      preferredCity: null,
      acceptedLocationTypes: scenario.candidate.locations,
      acceptedEmploymentTypes: scenario.candidate.employment,
    },
    totalExperienceYears: scenario.candidate.years,
    experienceAsOfMonth: "2026-07",
    seniorityLevel: scenario.candidate.seniority,
    managementExperience: false,
    domainKeywords: [],
  };
  const candidate: ScoringCandidate = {
    evidence,
    normalizedSkills: new Set(scenario.candidate.skills.map(normalizeSkill)),
    totalExperienceYears: scenario.candidate.years,
    seniorityLevel: scenario.candidate.seniority,
    managementExperience: false,
    domainKeywords: new Set(),
  };
  return scoreDeterministically(candidate, {
    title: "Synthetic role",
    description: null,
    location: scenario.job.locationType === "onsite" ? "Different City" : null,
    locationType: scenario.job.locationType,
    seniorityLevel: scenario.job.seniorityLevel,
    department: null,
    employmentType: scenario.job.employmentType,
    compensationText: null,
  }, {
    mustHaveSkills: scenario.analysis.must,
    preferredSkills: scenario.analysis.preferred,
    minimumExperienceYears: scenario.analysis.years,
    seniorityLevel: scenario.analysis.seniority,
    managementTrack: null,
    educationRequirements: [],
    locationConstraints: [],
    employmentType: scenario.job.employmentType,
    compensationText: null,
    domainKeywords: [],
    extractionConfidence: scenario.analysis.confidence,
    ambiguities: [],
  });
}

describe("synthetic evidence matcher evaluation", () => {
  const scores = new Map(corpus.scenarios.map((scenario) => [
    scenario.id,
    evaluateScenario(scenario),
  ]));

  it.each(corpus.scenarios)("keeps $id inside its labeled score band", (scenario) => {
    const result = scores.get(scenario.id)!;
    expect(result.score).toBeGreaterThanOrEqual(scenario.expected.min);
    expect(result.score).toBeLessThanOrEqual(scenario.expected.max);
    expect(result.hardCap).toBe(scenario.expected.hardCap);
  });

  it("achieves at least 85% pairwise ranking accuracy", () => {
    const correct = corpus.pairwise.filter(([higherId, lowerId]) =>
      scores.get(higherId)!.score > scores.get(lowerId)!.score
    ).length;
    const accuracy = correct / corpus.pairwise.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });
});
