import { describe, expect, it, vi } from "vitest";

import {
  calculateTotalExperienceYears,
  htmlToText,
} from "@/lib/ai/matcher/utils";

describe("matcher utils", () => {
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

  it("converts html to readable text with spacing", () => {
    const text = htmlToText("<p>Hello&nbsp;World</p><ul><li>One</li><li>Two</li></ul>");
    expect(text).toContain("Hello World");
    expect(text).toContain("One");
    expect(text).toContain("Two");
  });
});
