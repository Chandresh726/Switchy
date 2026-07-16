import { describe, expect, it } from "vitest";

import type { JobAnalysisEvidence } from "@/lib/ai/artifacts/schemas";
import {
  buildAnalysisBatches,
  buildAnalysisPrompt,
  buildJobAnalysisVersion,
  groundJobAnalysisEvidence,
  MAX_ANALYSIS_PROMPT_CHARS,
} from "@/lib/ai/matcher/evidence/job-analysis";
import type { JobData, MatcherConfig } from "@/lib/ai/matcher/types";

function job(id: number, description: string): JobData {
  return {
    id,
    title: "Senior Platform Engineer",
    description,
    location: "Remote",
    locationType: "remote",
    salary: null,
    department: "Engineering",
    employmentType: "full-time",
    seniorityLevel: "senior",
  };
}

function analysis(): JobAnalysisEvidence {
  return {
    summary: "Senior platform role building TypeScript services.",
    requirements: [{
      id: "provider-id",
      type: "technology",
      text: "Build services with TypeScript",
      importance: "important",
      sourceEvidence: "Build services with TypeScript",
    }, {
      id: "hallucinated",
      type: "education",
      text: "PhD required",
      importance: "critical",
      sourceEvidence: "PhD required",
    }],
  };
}

const config: MatcherConfig = {
  jobAnalysisProviderId: "provider-a",
  jobAnalysisModel: "analysis-a",
  jobAnalysisReasoningEffort: "high",
  providerId: "provider-b",
  model: "match-b",
  reasoningEffort: "medium",
  batchSize: 2,
  maxRetries: 2,
  concurrencyLimit: 2,
  timeoutMs: 120_000,
  backoffBaseDelay: 250,
  backoffMaxDelay: 2_000,
  autoMatchAfterScrape: true,
};

describe("AI job analysis", () => {
  it("keeps source-grounded concise requirements and drops invented evidence", () => {
    const grounded = groundJobAnalysisEvidence(
      analysis(),
      job(1, "You will Build services with TypeScript for our platform.")
    );

    expect(grounded).toEqual({
      summary: "Senior platform role building TypeScript services.",
      requirements: [{
        id: "requirement:1",
        type: "technology",
        text: "Build services with TypeScript",
        importance: "important",
        sourceEvidence: "Build services with TypeScript",
      }],
    });
  });

  it("versions analyses by the selected analysis provider, model, and reasoning", () => {
    const base = buildJobAnalysisVersion(config);
    expect(buildJobAnalysisVersion({ ...config, jobAnalysisModel: "analysis-b" }))
      .not.toBe(base);
    expect(buildJobAnalysisVersion({ ...config, model: "different-match-model" }))
      .toBe(base);
  });

  it("bounds batches by job count and prompt characters", () => {
    const jobs = [job(1, "a".repeat(35_000)), job(2, "b".repeat(35_000))];
    const batches = buildAnalysisBatches(jobs, 10);
    expect(batches).toHaveLength(2);
    expect(buildAnalysisPrompt(batches[0]).length).toBeLessThanOrEqual(
      MAX_ANALYSIS_PROMPT_CHARS
    );
  });
});
