import { describe, expect, it } from "vitest";

import { APIValidationError } from "@/lib/api/ai-error-handler";
import {
  DEFAULT_SETTINGS,
  parseSettingsUpdateBody,
} from "@/lib/settings/settings-service";

describe("settings service", () => {
  it("includes AI defaults required by the UI", () => {
    expect(DEFAULT_SETTINGS.matcher_reasoning_effort).toBe("medium");
    expect(DEFAULT_SETTINGS.resume_parser_reasoning_effort).toBe("medium");
    expect(DEFAULT_SETTINGS.ai_writing_reasoning_effort).toBe("medium");
    expect(DEFAULT_SETTINGS.scraper_max_parallel_scrapes).toBe("3");
  });

  it("parses scheduler toggles and numeric matcher settings", () => {
    const parsed = parseSettingsUpdateBody({
      scheduler_enabled: true,
      matcher_batch_size: "4",
      matcher_timeout_ms: 45000,
    });

    expect(parsed.enabledChanged).toBe(true);
    expect(parsed.newEnabledValue).toBe(true);
    expect(parsed.updates).toEqual(
      expect.arrayContaining([
        { key: "scheduler_enabled", value: "true" },
        { key: "matcher_batch_size", value: "4" },
        { key: "matcher_timeout_ms", value: "45000" },
      ])
    );
  });

  it("normalizes keyword arrays from JSON strings", () => {
    const parsed = parseSettingsUpdateBody({
      scraper_filter_title_keywords: '[" engineer ", "", "backend"]',
    });

    expect(parsed.updates).toEqual([
      {
        key: "scraper_filter_title_keywords",
        value: JSON.stringify(["engineer", "backend"]),
      },
    ]);
  });

  it("parses scraper max parallel scrapes setting", () => {
    const parsed = parseSettingsUpdateBody({
      scraper_max_parallel_scrapes: 4,
    });

    expect(parsed.updates).toEqual([
      {
        key: "scraper_max_parallel_scrapes",
        value: "4",
      },
    ]);
  });

  it("normalizes cover letter focus arrays and removes unsupported values", () => {
    const parsed = parseSettingsUpdateBody({
      cover_letter_focus: ["skills", "all", "experience", "invalid"],
    });

    expect(parsed.updates).toEqual([
      {
        key: "cover_letter_focus",
        value: JSON.stringify(["skills", "experience"]),
      },
    ]);
  });

  it("throws validation errors for invalid cron expressions", () => {
    expect(() =>
      parseSettingsUpdateBody({
        scheduler_cron: "not a cron",
      })
    ).toThrow(APIValidationError);
  });

  it("throws validation errors for out-of-range matcher values", () => {
    expect(() =>
      parseSettingsUpdateBody({
        matcher_circuit_breaker_threshold: 100,
      })
    ).toThrow(APIValidationError);
  });

  it("throws validation errors for out-of-range scraper parallel scrapes", () => {
    expect(() =>
      parseSettingsUpdateBody({
        scraper_max_parallel_scrapes: 20,
      })
    ).toThrow(APIValidationError);
  });
});
