import { describe, expect, it } from "vitest";

import {
  normalizeResumeData,
  ResumeDataSchema,
} from "@/lib/ai/resume/schema";

describe("resume normalization", () => {
  it("normalizes values and reports field-level warnings without rejecting the resume", () => {
    const input = ResumeDataSchema.parse({
      name: "  ",
      linkedinUrl: "https://github.com/not-linkedin",
      githubUrl: "http://127.0.0.1/profile",
      portfolioUrl: "javascript:alert(1)",
      skills: [
        { name: " TypeScript ", category: " language " },
        { name: "typescript", category: "language" },
        { name: " " },
      ],
      experience: [{
        company: " ",
        title: " Engineer ",
        startDate: "Spring 2024",
        endDate: "2024-13",
      }],
      education: [{
        institution: " Example University ",
        degree: " ",
        endDate: "2020",
      }],
    });

    const result = normalizeResumeData(input);

    expect(result.parsedData.skills).toEqual([
      { name: "TypeScript", category: "language" },
    ]);
    expect(result.parsedData.experience[0]).toMatchObject({
      company: "",
      title: "Engineer",
    });
    expect(result.warnings.map(({ code, path }) => ({ code, path }))).toEqual(expect.arrayContaining([
      { code: "empty_required_field", path: "name" },
      { code: "duplicate_skill", path: "skills.1.name" },
      { code: "empty_required_field", path: "skills.2.name" },
      { code: "empty_required_field", path: "experience.0.company" },
      { code: "malformed_date", path: "experience.0.startDate" },
      { code: "malformed_date", path: "experience.0.endDate" },
      { code: "empty_required_field", path: "education.0.degree" },
      { code: "malformed_date", path: "education.0.endDate" },
      { code: "suspicious_url", path: "linkedinUrl" },
      { code: "suspicious_url", path: "githubUrl" },
      { code: "suspicious_url", path: "portfolioUrl" },
    ]));
  });

  it("returns no warnings for normalized structured data", () => {
    const input = ResumeDataSchema.parse({
      name: "Alex Rivera",
      linkedinUrl: "https://linkedin.com/in/alex-rivera",
      githubUrl: "https://github.com/alex-rivera",
      portfolioUrl: "https://alex.example.test",
      skills: [{ name: "TypeScript" }],
      experience: [{
        company: "Northstar Labs",
        title: "Engineer",
        startDate: "2021-06",
        endDate: null,
      }],
      education: [{
        institution: "Example University",
        degree: "BSc Computer Science",
        endDate: "2018-05",
      }],
    });

    expect(normalizeResumeData(input).warnings).toEqual([]);
  });

  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/profile",
    "http://127.23.45.67/profile",
    "http://[::1]/profile",
    "http://[fc00::1]/profile",
    "http://[fe80::1]/profile",
    "http://service.local/profile",
  ])("warns for non-public portfolio URL %s", (portfolioUrl) => {
    const input = ResumeDataSchema.parse({
      name: "Alex Rivera",
      portfolioUrl,
      skills: [],
      experience: [],
    });

    expect(normalizeResumeData(input).warnings).toContainEqual(expect.objectContaining({
      code: "suspicious_url",
      path: "portfolioUrl",
    }));
  });

  it("caps warnings deterministically for a maximally malformed schema-valid result", () => {
    const input = ResumeDataSchema.parse({
      name: "",
      portfolioUrl: "http://127.0.0.1/profile",
      skills: Array.from({ length: 500 }, () => ({ name: "" })),
      experience: Array.from({ length: 100 }, () => ({
        company: "",
        title: "",
        startDate: "unknown",
        endDate: "unknown",
      })),
      education: Array.from({ length: 100 }, () => ({
        institution: "",
        degree: "",
        startDate: "unknown",
        endDate: "unknown",
      })),
    });

    const first = normalizeResumeData(input).warnings;
    const second = normalizeResumeData(input).warnings;
    expect(first).toHaveLength(1_000);
    expect(second).toEqual(first);
  });
});
