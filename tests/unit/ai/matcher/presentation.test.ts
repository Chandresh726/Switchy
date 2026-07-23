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
  breakdownJson: JSON.stringify({
    responsibilities: 90,
    skillsAndTechnologies: 88,
    experienceAndSeniority: 84,
    domainFit: 76,
  }),
  evidenceJson: JSON.stringify({
    summary: "Strong backend alignment with one preference to confirm.",
    reasoning: [{
      type: "match",
      text: "Related backend service work demonstrates the same competency.",
      candidateEvidenceReferences: ["experience:0"],
      jobRequirementReferences: ["requirement:1"],
    }],
    matchedSkills: ["typescript"],
  }),
  source: "ai",
  isStale: false,
  createdAt: new Date("2026-07-14T00:00:00.000Z"),
};

describe("authoritative match presentation", () => {
  it("presents a result for the current candidate as fresh", () => {
    expect(selectMatchPresentation(job, [row], context)).toMatchObject({
      matchScore: 88,
      matchResultId: "result-1",
      matchStale: false,
      matchSummary: "Strong backend alignment with one preference to confirm.",
      matchReasoning: [{
        type: "match",
        text: "Related backend service work demonstrates the same competency.",
      }],
      matchedSkills: ["typescript"],
    });
  });

  it("does not mark job-content mutations stale", () => {
    expect(selectMatchPresentation(
      { ...job, description: "Changed requirements" },
      [row],
      context
    )).toMatchObject({
      matchScore: 88,
      matchResultId: "result-1",
      matchStale: false,
    });
  });

  it("marks only candidate changes stale", () => {
    expect(selectMatchPresentation(job, [row], {
      ...context,
      candidateFingerprint: "b".repeat(64),
    })).toMatchObject({
      matchScore: 88,
      matchResultId: "result-1",
      matchStale: true,
      matchSummary: "Strong backend alignment with one preference to confirm.",
    });
    expect(selectMatchPresentation(job, [row], {
      ...context,
      scoringPolicyVersion: "evidence-score-v2",
    }).matchStale).toBe(false);
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
    }, [], context)).toMatchObject({
      matchScore: 77,
      matchReasons: ["Strong skill fit"],
      matchedSkills: ["TypeScript"],
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
      matchBreakdown: null,
      matchStale: false,
      matchLegacy: true,
    });
  });
});
