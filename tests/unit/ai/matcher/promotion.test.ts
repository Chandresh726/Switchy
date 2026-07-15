import { describe, expect, it } from "vitest";

import {
  countPromotedMatchRows,
  isPromotedMatch,
} from "@/lib/ai/matcher/promotion";

describe("match promotion policy", () => {
  it("promotes only good or high current results", () => {
    expect(isPromotedMatch({ matchBand: "high", matchScore: 90 })).toBe(true);
    expect(isPromotedMatch({ matchBand: "good", matchScore: 72 })).toBe(true);
    expect(isPromotedMatch({
      matchBand: "insufficient_evidence",
      matchScore: 90,
    })).toBe(false);
    expect(isPromotedMatch({ matchBand: "possible", matchScore: 69 })).toBe(false);
  });

  it("keeps explicitly labeled legacy compatibility behavior", () => {
    expect(isPromotedMatch({ matchLegacy: true, matchScore: 75 })).toBe(true);
    expect(isPromotedMatch({ matchLegacy: true, matchScore: 60 })).toBe(false);
    expect(isPromotedMatch({ matchScore: 90 })).toBe(false);
  });

  it("counts promoted matches beyond the company display-page limit", () => {
    const evidence = (matchBand: "good" | "low", roleFitScore: number) => JSON.stringify({
      reasons: [],
      matchedSkills: [],
      missingSkills: [],
      recommendations: [],
      componentEvidence: {},
      summary: `${matchBand} fit`,
      matchBand,
      roleFitScore,
      evidenceCoverage: 1,
      extractionConfidence: 1,
      constraints: [],
      requirementAssessments: [],
    });
    const rows = [
      ...Array.from({ length: 55 }, () => ({
        evidenceJson: evidence("low", 30),
        legacyScore: null,
      })),
      ...Array.from({ length: 5 }, () => ({
        evidenceJson: evidence("good", 75),
        legacyScore: null,
      })),
    ];

    expect(countPromotedMatchRows(rows)).toBe(5);
  });
});
