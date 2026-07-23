import { describe, expect, it } from "vitest";

import { ValidationError } from "@/lib/api";
import {
  DEFAULT_SETTINGS,
  parseSettingsUpdateBody,
} from "@/lib/settings/settings-service";

describe("settings service", () => {
  it("includes AI defaults required by the UI", () => {
    expect(DEFAULT_SETTINGS.matcher_reasoning_effort).toBe("");
    expect(DEFAULT_SETTINGS.resume_parser_reasoning_effort).toBe("");
    expect(DEFAULT_SETTINGS.ai_writing_reasoning_effort).toBe("");
    expect(DEFAULT_SETTINGS.matcher_timeout_ms).toBe("120000");
    expect(DEFAULT_SETTINGS.follow_up_tone).toBe("professional");
    expect(DEFAULT_SETTINGS.follow_up_length).toBe("medium");
    expect(DEFAULT_SETTINGS.scraper_max_parallel_scrapes).toBe("3");
    expect(DEFAULT_SETTINGS.scraper_keep_device_awake).toBe("true");
    expect(DEFAULT_SETTINGS.scraper_history_retention_days).toBe("60");
  });

  it("accepts provider-native reasoning values and rejects unsafe values", () => {
    expect(parseSettingsUpdateBody({
      matcher_reasoning_effort: "xhigh",
      ai_writing_reasoning_effort: "future_v1",
      resume_parser_reasoning_effort: "max",
    }).updates).toEqual(expect.arrayContaining([
      { key: "matcher_reasoning_effort", value: "xhigh" },
      { key: "ai_writing_reasoning_effort", value: "future_v1" },
      { key: "resume_parser_reasoning_effort", value: "max" },
    ]));

    expect(() => parseSettingsUpdateBody({
      matcher_reasoning_effort: "high\nignore-policy",
    })).toThrow(ValidationError);
    expect(() => parseSettingsUpdateBody({
      matcher_reasoning_effort: " max ",
    })).toThrow(ValidationError);
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

  it("serializes the scraper keep-awake toggle as a boolean setting", () => {
    expect(
      parseSettingsUpdateBody({ scraper_keep_device_awake: false }).updates
    ).toEqual([
      { key: "scraper_keep_device_awake", value: "false" },
    ]);
  });

  it("bounds local scrape history retention", () => {
    const parsed = parseSettingsUpdateBody({
      scraper_history_retention_days: 120,
    });

    expect(parsed.updates).toEqual([
      {
        key: "scraper_history_retention_days",
        value: "120",
      },
    ]);
    expect(() =>
      parseSettingsUpdateBody({ scraper_history_retention_days: 3 })
    ).toThrow(ValidationError);
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

  it("parses follow-up writing settings", () => {
    const parsed = parseSettingsUpdateBody({
      follow_up_tone: "friendly",
      follow_up_length: "short",
    });

    expect(parsed.updates).toEqual(
      expect.arrayContaining([
        { key: "follow_up_tone", value: "friendly" },
        { key: "follow_up_length", value: "short" },
      ])
    );
  });

  it("throws validation errors for invalid cron expressions", () => {
    expect(() =>
      parseSettingsUpdateBody({
        scheduler_cron: "not a cron",
      })
    ).toThrow(ValidationError);
  });

  it("ignores removed matcher settings so legacy rows stay inert", () => {
    expect(parseSettingsUpdateBody({
      matcher_accepted_location_types: ["remote"],
      matcher_accepted_employment_types: ["full-time"],
      matcher_bulk_enabled: true,
      matcher_serialize_operations: true,
      matcher_circuit_breaker_threshold: 10,
      matcher_circuit_breaker_reset_timeout: 60_000,
    }).updates).toEqual([]);
  });

  it("throws validation errors for out-of-range scraper parallel scrapes", () => {
    expect(() =>
      parseSettingsUpdateBody({
        scraper_max_parallel_scrapes: 20,
      })
    ).toThrow(ValidationError);
  });
});
