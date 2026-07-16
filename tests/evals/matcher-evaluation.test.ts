import { describe, expect, it } from "vitest";

import type { AIMatchOutcome } from "@/lib/ai/artifacts/schemas";
import { validateAIMatchOutcome } from "@/lib/ai/matcher/evidence/ai-match";

function outcome(score: number): AIMatchOutcome {
  return {
    score,
    summary: "The candidate has relevant, transferable experience.",
    categoryScores: {
      responsibilities: score,
      skillsAndTechnologies: score,
      experienceAndSeniority: score,
      domainFit: score,
    },
    reasoning: [{
      type: "match",
      text: "The candidate has equivalent ownership experience.",
      candidateEvidenceReferences: ["experience:0"],
      jobRequirementReferences: ["requirement:1"],
    }],
    matchedSkills: ["distributed systems"],
  };
}

describe("AI-only matcher evaluation contract", () => {
  const candidateIds = new Set(["experience:0"]);
  const requirementIds = new Set(["requirement:1"]);

  it.each([92, 78, 62, 48, 30])("accepts a grounded score of %s", (score) => {
    expect(validateAIMatchOutcome(
      outcome(score),
      candidateIds,
      requirementIds
    )).toBe(true);
  });

  it("rejects invented evidence", () => {
    const invented = outcome(78);
    invented.reasoning[0].candidateEvidenceReferences = ["experience:999"];
    expect(validateAIMatchOutcome(invented, candidateIds, requirementIds)).toBe(false);
  });
});
