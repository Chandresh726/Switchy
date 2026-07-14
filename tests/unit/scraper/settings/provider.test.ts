import { describe, expect, it, vi } from "vitest";

import { StoredScrapeSettingsProvider } from "@/lib/scraper/settings/provider";

function createProvider(values: Record<string, string | null | undefined>) {
  const source = {
    getSetting: vi.fn(async (key: string) => values[key] ?? null),
  };
  return { provider: new StoredScrapeSettingsProvider(source), source };
}

describe("StoredScrapeSettingsProvider", () => {
  it("returns typed filters and normalizes title keywords", async () => {
    const { provider } = createProvider({
      scraper_filter_country: "India",
      scraper_filter_city: "Bengaluru",
      scraper_filter_title_keywords: '[" Engineer ", 4, "PLATFORM", ""]',
    });

    await expect(provider.getFilters({ country: "US" })).resolves.toEqual({
      country: "India",
      city: "Bengaluru",
      titleKeywords: ["engineer", "platform"],
    });
  });

  it("keeps configured defaults when stored filter values are empty or invalid", async () => {
    const { provider } = createProvider({
      scraper_filter_country: "",
      scraper_filter_city: null,
      scraper_filter_title_keywords: "not-json",
    });
    const defaults = {
      country: "US",
      city: "Austin",
      titleKeywords: ["developer"],
    };

    await expect(provider.getFilters(defaults)).resolves.toEqual(defaults);
  });

  it.each([
    ["1", 1],
    ["10", 10],
    ["0", 3],
    ["11", 3],
    ["invalid", 3],
  ])("parses max parallel scrapes %s as %i", async (stored, expected) => {
    const { provider } = createProvider({
      scraper_max_parallel_scrapes: stored,
    });

    await expect(provider.getMaxParallelScrapes()).resolves.toBe(expected);
  });

  it.each([
    [null, true],
    ["true", true],
    ["false", false],
  ])("parses keep-awake value %s as %s", async (stored, expected) => {
    const { provider } = createProvider({
      scraper_keep_device_awake: stored,
    });

    await expect(provider.getKeepDeviceAwake()).resolves.toBe(expected);
  });

  it.each([
    ["7", 7],
    ["3650", 3650],
    ["6", 90],
    ["3651", 90],
    [null, 90],
  ])("parses retention %s as %i days", async (stored, expected) => {
    const { provider } = createProvider({
      scraper_history_retention_days: stored,
    });

    await expect(provider.getHistoryRetentionDays()).resolves.toBe(expected);
  });
});
