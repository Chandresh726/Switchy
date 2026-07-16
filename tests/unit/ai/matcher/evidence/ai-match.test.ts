import { describe, expect, it, vi } from "vitest";

import type { AIMatchOutcome, CandidateEvidence } from "@/lib/ai/artifacts/schemas";
import {
  buildPersistedMatchArtifacts,
  evaluateMatchWithAI,
  validateAIMatchOutcome,
} from "@/lib/ai/matcher/evidence/ai-match";
import type { MatchingJobAnalysis } from "@/lib/ai/matcher/evidence/job-analysis";
import { DEFAULT_MATCHER_CONFIG } from "@/lib/ai/matcher/types";
import type { AICapabilityRuntime } from "@/lib/ai/runtime/capability-runtime";

function outcome(): AIMatchOutcome {
  return {
    score: 88,
    summary: "Strong fit with relevant product engineering experience.",
    categoryScores: {
      responsibilities: 88,
      skillsAndTechnologies: 88,
      experienceAndSeniority: 88,
      domainFit: 88,
    },
    reasoning: [{
      type: "match",
      text: "The candidate has directly relevant ownership experience.",
      candidateEvidenceReferences: ["summary:1"],
      jobRequirementReferences: ["requirement:1"],
    }],
    matchedSkills: ["TypeScript"],
  };
}

describe("AI match input", () => {
  it("accepts concise grounded category scores and reasoning", () => {
    expect(validateAIMatchOutcome(
      outcome(),
      new Set(["summary:1"]),
      new Set(["requirement:1"])
    )).toBe(true);
  });

  it("rejects ungrounded reasoning", () => {
    const ungrounded = outcome();
    ungrounded.reasoning[0].candidateEvidenceReferences = ["summary:missing"];
    expect(validateAIMatchOutcome(
      ungrounded,
      new Set(["summary:1"]),
      new Set(["requirement:1"])
    )).toBe(false);
  });

  it("persists only the simplified match result", () => {
    expect(buildPersistedMatchArtifacts(outcome())).toEqual({
      breakdown: {
        responsibilities: 88,
        skillsAndTechnologies: 88,
        experienceAndSeniority: 88,
        domainFit: 88,
      },
      evidence: {
        summary: "Strong fit with relevant product engineering experience.",
        reasoning: outcome().reasoning,
        matchedSkills: ["TypeScript"],
      },
    });
  });

  it("passes complete candidate facts and the concise saved job analysis", async () => {
    const executeStructured = vi.fn().mockResolvedValue({
      output: outcome(),
      runId: "match-run",
      attempts: 1,
    });
    const runtime = {
      reasoningEffort: "xhigh",
      executeStructured,
    } as unknown as AICapabilityRuntime;
    const candidate: CandidateEvidence = {
      summary: "Product engineer",
      skills: Array.from({ length: 150 }, (_, index) => ({
        name: `Skill ${index}`,
        category: "frontend",
      })),
      experience: [{
        title: "Engineer",
        company: "Example",
        description: "Built products",
        location: "Bengaluru",
        startDate: "2021-01",
        endDate: "2025-01",
        highlights: ["Led migration"],
      }],
      education: [{
        institution: "Example University",
        degree: "B.Tech",
        field: "Computer Science",
        startDate: "2016-01",
        endDate: "2020-01",
        gpa: "8.7",
        honors: "Distinction",
      }],
      preferences: { preferredCountry: "India", preferredCity: "Bengaluru" },
      totalExperienceYears: 4,
      experienceAsOfMonth: "2026-07",
      seniorityLevel: null,
      managementExperience: false,
      domainKeywords: [],
    };
    const job = {
      job: {
        id: 10,
        title: "Senior Product Engineer",
        description: "Synthetic description",
        location: "Bengaluru",
        locationType: "hybrid",
        salary: null,
        department: "Product",
        employmentType: "full-time",
        seniorityLevel: "senior",
      },
      jobEvidence: {
        title: "Senior Product Engineer",
        description: "Synthetic description",
        location: "Bengaluru",
        locationType: "hybrid",
        seniorityLevel: "senior",
        department: "Product",
        employmentType: "full-time",
        compensationText: null,
      },
      jobFingerprint: "b".repeat(64),
      jobAnalysisId: "analysis-1",
      analysis: {
        summary: "Senior role owning product engineering outcomes.",
        requirements: [{
          id: "requirement:1",
          type: "responsibility",
          text: "Own product engineering outcomes",
          importance: "important",
          sourceEvidence: "Own product engineering outcomes",
        }],
      },
    } satisfies MatchingJobAnalysis;

    await evaluateMatchWithAI(
      runtime,
      candidate,
      "a".repeat(64),
      job,
      { ...DEFAULT_MATCHER_CONFIG, model: "model-1", providerId: "provider-1" }
    );

    const prompt = JSON.parse(executeStructured.mock.calls[0]?.[0].prompt) as {
      candidate: { evidence: Array<{ text: string }> };
      job: Record<string, unknown>;
    };
    expect(prompt.candidate.evidence.map((item) => item.text).join("\n"))
      .toContain("GPA: 8.7");
    expect(prompt.job).toEqual({
      title: "Senior Product Engineer",
      location: "Bengaluru",
      summary: "Senior role owning product engineering outcomes.",
      requirements: job.analysis.requirements,
    });
  });
});
