import { describe, expect, it, vi } from "vitest";

import {
  applyExperienceScoreGuardrails,
  calculateTotalExperienceYears,
  deriveCandidateExperienceYears,
  estimateRequiredExperienceYears,
  extractRequirements,
  htmlToText,
} from "@/lib/ai/matcher/utils";

describe("matcher utils", () => {
  it("extracts unique bullet requirements", () => {
    const requirements = extractRequirements(`
      - 5+ years of experience
      - TypeScript
      - TypeScript
      1. Strong communication
    `);

    expect(requirements).toEqual([
      "5+ years of experience",
      "TypeScript",
      "Strong communication",
    ]);
  });

  it("merges overlapping experience intervals into total years", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-20T00:00:00.000Z"));

    const years = calculateTotalExperienceYears([
      { startDate: "2020-01-01", endDate: "2022-01-01" },
      { startDate: "2021-06-01", endDate: "2024-01-01" },
      { startDate: "2025-01-01", endDate: null },
    ]);

    expect(years).toBeCloseTo(5.1, 1);

    vi.useRealTimers();
  });

  it("does not count employment beyond the fixed reference time", () => {
    const referenceTime = Date.parse("2026-07-01T00:00:00.000Z");
    const years = calculateTotalExperienceYears([
      { startDate: "2024-07-01", endDate: "2030-07-01" },
      { startDate: "2020-01-01", endDate: "not-a-date" },
    ], referenceTime);

    expect(years).toBe(2);
  });

  it("derives candidate years from role history", () => {
    expect(deriveCandidateExperienceYears(3)).toBe(3);
    expect(deriveCandidateExperienceYears(null)).toBeNull();
  });

  it("estimates required years using range and minimum hints", () => {
    const description = `
      Minimum 3 years of experience required.
      We also value 5-7 years of experience in backend systems.
    `;

    const years = estimateRequiredExperienceYears(description, [
      "At least 4 years of experience with Node.js",
    ]);

    expect(years).toBe(5);
  });

  it("applies score guardrails when experience gap is significant", () => {
    const adjusted = applyExperienceScoreGuardrails(88, 6, 2);

    expect(adjusted.adjustedScore).toBeLessThan(88);
    expect(adjusted.reason).toContain("role asks ~6 years");
  });

  it("converts html to readable text with spacing", () => {
    const text = htmlToText("<p>Hello&nbsp;World</p><ul><li>One</li><li>Two</li></ul>");
    expect(text).toContain("Hello World");
    expect(text).toContain("One");
    expect(text).toContain("Two");
  });
});
