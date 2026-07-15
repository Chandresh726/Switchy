import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildScoringCandidate } from "@/lib/ai/matcher/evidence/candidate";
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
    contextual: z.array(z.string()).default([]),
    years: z.number().nullable(),
    seniority: NullableString,
    confidence: z.number().min(0).max(1),
  }),
  expected: z.object({
    min: z.number(),
    max: z.number(),
    band: z.enum(["high", "good", "possible", "stretch", "low", "insufficient_evidence"]),
    blockingConflict: z.boolean().default(false),
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
  const candidate = buildScoringCandidate(evidence);
  const requirements = [
    ...scenario.analysis.must.map((skill, index) => ({
      id: `requirement:${index + 1}`,
      type: "technology" as const,
      text: `${skill} experience`,
      terms: [skill],
      alternatives: [],
      importance: "important" as const,
      explicitness: "explicit" as const,
      experienceYears: null,
      experienceScope: null,
      sourceEvidence: `${skill} experience`,
      confidence: scenario.analysis.confidence,
    })),
    ...scenario.analysis.preferred.map((skill, index) => ({
      id: `preferred:${index + 1}`,
      type: "technology" as const,
      text: `${skill} preferred`,
      terms: [skill],
      alternatives: [],
      importance: "preferred" as const,
      explicitness: "explicit" as const,
      experienceYears: null,
      experienceScope: null,
      sourceEvidence: `${skill} preferred`,
      confidence: scenario.analysis.confidence,
    })),
    ...scenario.analysis.contextual.map((skill, index) => ({
      id: `contextual:${index + 1}`,
      type: "technology" as const,
      text: `${skill} appears in the team stack`,
      terms: [skill],
      alternatives: [],
      importance: "contextual" as const,
      explicitness: "implied" as const,
      experienceYears: null,
      experienceScope: null,
      sourceEvidence: `Our stack includes ${skill}`,
      confidence: scenario.analysis.confidence,
    })),
  ];
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
    requirements,
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
    expect(result.matchBand).toBe(scenario.expected.band);
    expect(result.constraints.some((constraint) =>
      constraint.status === "conflict" && constraint.severity === "blocking"
    )).toBe(scenario.expected.blockingConflict);
  });

  it("achieves at least 85% pairwise ranking accuracy", () => {
    const correct = corpus.pairwise.filter(([higherId, lowerId]) =>
      scores.get(higherId)!.score > scores.get(lowerId)!.score
    ).length;
    const accuracy = correct / corpus.pairwise.length;
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it("keeps a six-month experience difference within two score points of a full match", () => {
    expect(scores.get("strong_remote_fit")!.score - scores.get("six_month_gap")!.score)
      .toBeLessThanOrEqual(2);
  });

  it("does not let contextual stack technologies reduce fit", () => {
    expect(scores.get("contextual_stack_mention")!.score)
      .toBe(scores.get("strong_remote_fit")!.score);
  });
});
