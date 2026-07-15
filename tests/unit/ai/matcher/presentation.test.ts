import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  buildJobEvidenceInput,
  buildJobFingerprint,
} from "@/lib/ai/artifacts/fingerprints";
import { selectMatchPresentation } from "@/lib/ai/matcher/presentation";

const candidateFingerprint = "a".repeat(64);

const job = {
  id: 1,
  title: "Backend Engineer",
  description: "Build TypeScript services",
  location: "Remote",
  locationType: "remote",
  seniorityLevel: "mid",
  department: "Engineering",
  employmentType: "full-time",
  salary: null,
  matchScore: null,
  matchReasons: null,
  matchedSkills: null,
  missingSkills: null,
  recommendations: null,
};

const jobFingerprint = buildJobFingerprint(buildJobEvidenceInput(job));
const context = {
  candidateFingerprint,
  scoringPolicyVersion: "evidence-score-v1-current",
};
const row = {
  id: "result-1",
  jobId: 1,
  candidateFingerprint,
  jobFingerprint,
  scoringPolicyVersion: context.scoringPolicyVersion,
  score: 88,
  breakdownJson: JSON.stringify({ mustHaveSkills: 100, experience: 75 }),
  evidenceJson: JSON.stringify({
    reasons: ["Strong required-skill coverage"],
    matchedSkills: ["typescript"],
    missingSkills: [],
    recommendations: [],
    componentEvidence: {},
  }),
  confidence: 0.84,
  source: "deterministic",
  isStale: false,
  createdAt: new Date("2026-07-14T00:00:00.000Z"),
};

describe("authoritative match presentation", () => {
  it("presents only an exact artifact and policy match as fresh", () => {
    expect(selectMatchPresentation(job, [row], context)).toMatchObject({
      matchScore: 88,
      matchResultId: "result-1",
      matchConfidence: 0.84,
      matchStale: false,
    });
  });

  it("marks relevant job-content mutations stale", () => {
    expect(selectMatchPresentation(
      { ...job, description: "Changed requirements" },
      [row],
      context
    )).toMatchObject({
      matchScore: null,
      matchResultId: "result-1",
      matchStale: true,
    });
  });

  it("marks candidate and scoring-policy changes stale", () => {
    expect(selectMatchPresentation(job, [row], {
      ...context,
      candidateFingerprint: "b".repeat(64),
    }).matchStale).toBe(true);
    expect(selectMatchPresentation(job, [row], {
      ...context,
      scoringPolicyVersion: "evidence-score-v2",
    }).matchStale).toBe(true);
  });

  it("ignores status-only mutations when determining freshness", () => {
    const statusChanged = { ...job, status: "applied" };
    expect(selectMatchPresentation(statusChanged, [row], context)).toMatchObject({
      matchScore: 88,
      matchStale: false,
    });
  });

  it("presents legacy job columns as a valid legacy score", () => {
    expect(selectMatchPresentation({
      ...job,
      matchScore: 77,
      matchReasons: '["Strong skill fit"]',
      matchedSkills: '["TypeScript"]',
      missingSkills: "malformed",
      recommendations: '["Apply"]',
    }, [], context)).toMatchObject({
      matchScore: 77,
      matchReasons: ["Strong skill fit"],
      matchedSkills: ["TypeScript"],
      missingSkills: [],
      recommendations: ["Apply"],
      matchResultId: null,
      matchStale: false,
      matchLegacy: true,
      scoringPolicyVersion: "legacy",
    });
  });

  it("presents an imported legacy result without treating it as stale", () => {
    expect(selectMatchPresentation({
      ...job,
      matchScore: 72,
    }, [{
      ...row,
      score: 72,
      source: "legacy",
      isStale: true,
      scoringPolicyVersion: "legacy-import-v1",
    }], context)).toMatchObject({
      matchScore: 72,
      matchResultId: "result-1",
      matchConfidence: null,
      matchBreakdown: null,
      matchStale: false,
      matchLegacy: true,
    });
  });
});
