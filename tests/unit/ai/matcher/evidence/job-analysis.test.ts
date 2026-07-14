import { describe, expect, it } from "vitest";

import {
  buildAnalysisBatches,
  buildAnalysisPrompt,
  buildDeterministicJobAnalysis,
  MAX_ANALYSIS_PROMPT_CHARS,
} from "@/lib/ai/matcher/evidence/job-analysis";
import type { JobData } from "@/lib/ai/matcher/types";

function job(id: number, description = ""): JobData {
  return {
    id,
    title: "Senior TypeScript Engineer",
    description,
    location: "Remote",
    locationType: "remote",
    salary: null,
    department: "engineering",
    employmentType: "full-time",
    seniorityLevel: "senior",
  };
}

describe("structured job analysis", () => {
  it("bounds batches by both job count and prompt characters", () => {
    const jobs = Array.from({ length: 7 }, (_, index) =>
      job(index + 1, "TypeScript experience required. ".repeat(600))
    );
    const batches = buildAnalysisBatches(jobs, 3);

    expect(batches.flat()).toHaveLength(jobs.length);
    expect(batches.every((batch) => batch.length <= 3)).toBe(true);
    expect(batches.every((batch) =>
      buildAnalysisPrompt(batch).length <= MAX_ANALYSIS_PROMPT_CHARS
    )).toBe(true);
  });

  it("bounds an escape-heavy singleton after JSON serialization", () => {
    const prompt = buildAnalysisPrompt([
      job(1, 'Quoted "instructions" and \\ paths.\n'.repeat(20_000)),
    ]);

    expect(prompt.length).toBeLessThanOrEqual(MAX_ANALYSIS_PROMPT_CHARS);
    expect(prompt).toContain('\\"instructions\\"');
  });

  it("bounds escape-heavy fields across a full batch", () => {
    const escaped = '"\\'.repeat(5_000);
    const jobs = Array.from({ length: 10 }, (_, index) => ({
      ...job(index + 1, escaped),
      title: escaped,
      location: escaped,
      department: escaped,
      salary: escaped,
    }));

    expect(buildAnalysisPrompt(jobs).length).toBeLessThanOrEqual(
      MAX_ANALYSIS_PROMPT_CHARS
    );
  });

  it("preserves structured fields while truncating an oversized description", () => {
    const originalDescription = "Long description. ".repeat(20_000);
    const oversized = {
      ...job(1, originalDescription),
      title: "Principal Distributed Systems Engineer",
      location: "London, United Kingdom",
      locationType: "onsite",
    };
    const serialized = buildAnalysisPrompt([oversized]).split("JOBS:\n")[1];
    const parsed = JSON.parse(serialized ?? "{}") as Record<string, unknown>;

    expect(parsed.title).toBe(oversized.title);
    expect(parsed.location).toBe(oversized.location);
    expect(parsed.locationType).toBe(oversized.locationType);
    expect(String(parsed.description).length).toBeLessThan(originalDescription.length);
  });

  it("provides low-confidence deterministic evidence when AI extraction fails", () => {
    const fallback = buildDeterministicJobAnalysis(job(
      1,
      "Requirements:\n- 5+ years of experience\n- TypeScript\n- AWS preferred\n- Bachelor's degree"
    ));

    expect(fallback.minimumExperienceYears).toBe(5);
    expect(fallback.mustHaveSkills).toContain("typescript");
    expect(fallback.preferredSkills).toContain("aws");
    expect(fallback.educationRequirements).toHaveLength(1);
    expect(fallback.extractionConfidence).toBeLessThan(0.4);
    expect(fallback.ambiguities[0]).toContain("fallback");
  });

  it("extracts fallback skills only from boundary-safe requirement evidence", () => {
    const fallback = buildDeterministicJobAnalysis(job(
      1,
      "Requirements:\n- JavaScript required\n- Experience with ongoing delivery"
    ));

    expect(fallback.mustHaveSkills).toContain("javascript");
    expect(fallback.mustHaveSkills).not.toContain("java");
    expect(fallback.mustHaveSkills).not.toContain("go");
  });

  it("classifies preferred skills with token boundaries", () => {
    const fallback = buildDeterministicJobAnalysis(job(
      1,
      "Requirements:\n- Java required\n- JavaScript preferred"
    ));

    expect(fallback.mustHaveSkills).toContain("java");
    expect(fallback.preferredSkills).toContain("javascript");
    expect(fallback.preferredSkills).not.toContain("java");
  });

  it("keeps must-have precedence when a skill is also preferred elsewhere", () => {
    const fallback = buildDeterministicJobAnalysis(job(
      1,
      "Requirements:\n- TypeScript required\n- TypeScript and AWS are a bonus"
    ));

    expect(fallback.mustHaveSkills).toContain("typescript");
    expect(fallback.preferredSkills).not.toContain("typescript");
    expect(fallback.preferredSkills).toContain("aws");
  });

  it("requires explicit management-track evidence outside a managerial title", () => {
    const individualContributor = buildDeterministicJobAnalysis(job(
      1,
      "This engineer will report to the engineering manager."
    ));
    const manager = buildDeterministicJobAnalysis({
      ...job(2, "You will manage a team of five engineers."),
      title: "Engineering Lead",
    });

    expect(individualContributor.managementTrack).toBeNull();
    expect(manager.managementTrack).toBe(true);
  });
});
