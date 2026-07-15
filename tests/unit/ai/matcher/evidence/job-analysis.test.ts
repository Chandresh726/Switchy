import { describe, expect, it } from "vitest";

import {
  buildAnalysisBatches,
  buildAnalysisPrompt,
  buildDeterministicJobAnalysis,
  canonicalizeJobAnalysisEvidence,
  groundJobAnalysisEvidence,
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

  it("instructs extraction not to treat stack mentions as mandatory", () => {
    const prompt = buildAnalysisPrompt([job(1, "Our stack includes Rust and Kubernetes.")]);

    expect(prompt).toContain("Technology names are not automatically mandatory");
    expect(prompt).toContain("contextual");
  });

  it("derives compatibility skill lists from requirement importance", () => {
    const evidence = canonicalizeJobAnalysisEvidence({
      mustHaveSkills: ["rust"],
      preferredSkills: [],
      minimumExperienceYears: null,
      seniorityLevel: null,
      managementTrack: null,
      educationRequirements: [],
      locationConstraints: [],
      employmentType: null,
      compensationText: null,
      domainKeywords: [],
      extractionConfidence: 0.9,
      ambiguities: [],
      requirements: [
        {
          id: "model-id-1",
          type: "technology",
          text: "TypeScript services",
          terms: ["TypeScript"],
          alternatives: [],
          importance: "important",
          explicitness: "explicit",
          experienceYears: null,
          experienceScope: null,
          sourceEvidence: "Build TypeScript services",
          confidence: 0.9,
        },
        {
          id: "model-id-2",
          type: "technology",
          text: "The team uses Rust",
          terms: ["Rust"],
          alternatives: [],
          importance: "contextual",
          explicitness: "implied",
          experienceYears: null,
          experienceScope: null,
          sourceEvidence: "Our stack includes Rust",
          confidence: 0.9,
        },
      ],
    });

    expect(evidence.mustHaveSkills).toEqual(["typescript"]);
    expect(evidence.preferredSkills).toEqual([]);
    expect(evidence.requirements?.map((requirement) => requirement.id)).toEqual([
      "requirement:1",
      "requirement:2",
    ]);
  });

  it("provides low-confidence deterministic evidence when AI extraction fails", () => {
    const fallback = buildDeterministicJobAnalysis(job(
      1,
      "Requirements:\n- 5+ years of experience\n- TypeScript\n- AWS preferred\n- Bachelor's degree"
    ));

    expect(fallback.minimumExperienceYears).toBe(5);
    expect(fallback.mustHaveSkills).toContain("typescript");
    expect(fallback.preferredSkills).toContain("amazon web services");
    expect(fallback.educationRequirements).toHaveLength(1);
    expect(fallback.extractionConfidence).toBeLessThan(0.4);
    expect(fallback.ambiguities[0]).toContain("fallback");
  });

  it("keeps scoped fallback experience out of the overall-years component", () => {
    const fallback = buildDeterministicJobAnalysis(job(
      1,
      "Requirements:\n- 5+ years of experience with React"
    ));

    expect(fallback.minimumExperienceYears).toBeNull();
    expect(fallback.requirements).toContainEqual(expect.objectContaining({
      type: "experience",
      experienceYears: 5,
      experienceScope: expect.stringContaining("React"),
    }));
  });

  it("discards extracted requirements whose source excerpt is not in the job", () => {
    const grounded = groundJobAnalysisEvidence({
      ...buildDeterministicJobAnalysis(job(1, "Build TypeScript services.")),
      mustHaveSkills: ["rust"],
      requirements: [{
        id: "hallucinated",
        type: "technology",
        text: "Rust is required",
        terms: ["rust"],
        alternatives: [],
        importance: "critical",
        explicitness: "explicit",
        experienceYears: null,
        experienceScope: null,
        sourceEvidence: "Build TypeScript services",
        confidence: 0.99,
      }],
    }, job(1, "Build TypeScript services."));

    expect(grounded.requirements).toEqual([]);
    expect(grounded.mustHaveSkills).not.toContain("rust");
    expect(grounded.ambiguities).toContainEqual(expect.stringContaining("without source grounding"));
  });

  it("rejects fabricated extra concepts even when one claimed term is grounded", () => {
    const grounded = groundJobAnalysisEvidence({
      ...buildDeterministicJobAnalysis(job(1, "Build TypeScript services.")),
      requirements: [{
        id: "mixed-claim",
        type: "technology",
        text: "TypeScript services",
        terms: ["TypeScript", "TS", "Rust"],
        alternatives: ["Go"],
        importance: "important",
        explicitness: "explicit",
        experienceYears: null,
        experienceScope: null,
        sourceEvidence: "Build TypeScript services",
        confidence: 0.99,
      }],
    }, job(1, "Build TypeScript services."));

    expect(grounded.requirements).toEqual([]);
    expect(grounded.mustHaveSkills).not.toContain("rust");
    expect(grounded.mustHaveSkills).not.toContain("go");
  });

  it("reconciles requirement importance from explicit source wording", () => {
    const description = [
      "TypeScript is required.",
      "AWS is preferred.",
      "Our stack includes Rust.",
      "You do not need Go.",
      "Familiarity with Kubernetes helps with team context.",
      "This role doesn't require Java.",
    ].join("\n");
    const baseRequirement = {
      id: "model-id",
      type: "technology" as const,
      alternatives: [],
      explicitness: "implied" as const,
      experienceYears: null,
      experienceScope: null,
      confidence: 0.9,
    };
    const grounded = groundJobAnalysisEvidence({
      ...buildDeterministicJobAnalysis(job(1, description)),
      requirements: [{
        ...baseRequirement,
        text: "TypeScript",
        terms: ["TypeScript"],
        importance: "contextual",
        sourceEvidence: "TypeScript is required",
      }, {
        ...baseRequirement,
        text: "AWS",
        terms: ["AWS"],
        importance: "contextual",
        sourceEvidence: "AWS is preferred",
      }, {
        ...baseRequirement,
        text: "Rust",
        terms: ["Rust"],
        importance: "critical",
        sourceEvidence: "Our stack includes Rust",
      }, {
        ...baseRequirement,
        text: "Go",
        terms: ["Go"],
        importance: "critical",
        sourceEvidence: "You do not need Go",
      }, {
        ...baseRequirement,
        text: "Kubernetes",
        terms: ["Kubernetes"],
        importance: "contextual",
        sourceEvidence: "Familiarity with Kubernetes helps with team context",
      }, {
        ...baseRequirement,
        text: "Java",
        terms: ["Java"],
        importance: "important",
        sourceEvidence: "This role doesn't require Java",
      }],
    }, job(1, description));

    expect(grounded.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ terms: ["typescript"], importance: "critical" }),
      expect.objectContaining({ terms: ["amazon web services"], importance: "preferred" }),
      expect.objectContaining({ terms: ["rust"], importance: "contextual" }),
      expect.objectContaining({ terms: ["go"], importance: "contextual" }),
      expect.objectContaining({ terms: ["kubernetes"], importance: "contextual" }),
      expect.objectContaining({ terms: ["java"], importance: "contextual" }),
    ]));
  });

  it("rejects termless claims that do not overlap their source excerpt", () => {
    const grounded = groundJobAnalysisEvidence({
      ...buildDeterministicJobAnalysis(job(1, "Build reliable software systems.")),
      requirements: [{
        id: "fabricated-responsibility",
        type: "responsibility",
        text: "Manage a team of twenty engineers",
        terms: [],
        alternatives: [],
        importance: "important",
        explicitness: "implied",
        experienceYears: null,
        experienceScope: null,
        sourceEvidence: "Build reliable software systems",
        confidence: 0.9,
      }],
    }, job(1, "Build reliable software systems."));

    expect(grounded.requirements).toEqual([]);
  });

  it("rejects a termless claim that shares only a generic action", () => {
    const grounded = groundJobAnalysisEvidence({
      ...buildDeterministicJobAnalysis(job(1, "Build reliable customer APIs.")),
      requirements: [{
        id: "fabricated-domain",
        type: "responsibility",
        text: "Build quantum computers",
        terms: [],
        alternatives: [],
        importance: "important",
        explicitness: "implied",
        experienceYears: null,
        experienceScope: null,
        sourceEvidence: "Build reliable customer APIs",
        confidence: 0.9,
      }],
    }, job(1, "Build reliable customer APIs."));

    expect(grounded.requirements).toEqual([]);
  });

  it("grounds written experience numbers and extracts them in fallback mode", () => {
    const description = "Requirements:\n- five years of experience";
    const sourceJob = job(1, description);
    const grounded = groundJobAnalysisEvidence({
      ...buildDeterministicJobAnalysis(sourceJob),
      requirements: [{
        id: "written-years",
        type: "experience",
        text: "Five years of experience",
        terms: [],
        alternatives: [],
        importance: "important",
        explicitness: "explicit",
        experienceYears: 5,
        experienceScope: "overall professional experience",
        sourceEvidence: "five years of experience",
        confidence: 0.9,
      }],
    }, sourceJob);

    expect(buildDeterministicJobAnalysis(sourceJob).minimumExperienceYears).toBe(5);
    expect(grounded.minimumExperienceYears).toBe(5);
    expect(grounded.requirements?.[0]?.experienceYears).toBe(5);
  });

  it("does not promote scoped work evidence into overall experience", () => {
    const description = [
      "Requirements:",
      "- 5 years of work with React",
      "- 3 years of experience",
    ].join("\n");
    const grounded = groundJobAnalysisEvidence({
      ...buildDeterministicJobAnalysis(job(1, description)),
      minimumExperienceYears: 5,
      requirements: [{
        id: "scoped-experience",
        type: "experience",
        text: "5 years of work with React",
        terms: ["React"],
        alternatives: [],
        importance: "important",
        explicitness: "explicit",
        experienceYears: 5,
        experienceScope: "work with React",
        sourceEvidence: "5 years of work with React",
        confidence: 0.9,
      }],
    }, job(1, description));

    expect(grounded.minimumExperienceYears).toBe(3);
    expect(grounded.requirements?.[0]).toMatchObject({
      experienceScope: "work with React",
      experienceYears: 5,
    });
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
    expect(fallback.preferredSkills).toContain("amazon web services");
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
