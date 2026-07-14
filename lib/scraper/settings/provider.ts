import type { ScrapeSettingsSource } from "@/lib/scraper/infrastructure/types";

import { SCRAPER_SETTINGS } from "./definitions";

export interface ScraperFilterSettings {
  country?: string;
  city?: string;
  titleKeywords?: string[];
}

export interface ScrapeSettingsProvider {
  getFilters(
    defaults?: ScraperFilterSettings
  ): Promise<ScraperFilterSettings>;
  getMaxParallelScrapes(): Promise<number>;
  getKeepDeviceAwake(): Promise<boolean>;
  getHistoryRetentionDays(): Promise<number>;
}

function parseTitleKeywords(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseBoundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

export class StoredScrapeSettingsProvider implements ScrapeSettingsProvider {
  constructor(private readonly source: ScrapeSettingsSource) {}

  async getFilters(
    defaults: ScraperFilterSettings = {}
  ): Promise<ScraperFilterSettings> {
    const [country, city, titleKeywordsRaw] = await Promise.all([
      this.source.getSetting(SCRAPER_SETTINGS.filterCountry.key),
      this.source.getSetting(SCRAPER_SETTINGS.filterCity.key),
      this.source.getSetting(SCRAPER_SETTINGS.filterTitleKeywords.key),
    ]);
    const titleKeywords = parseTitleKeywords(titleKeywordsRaw);
    return {
      ...defaults,
      country: country || defaults.country,
      city: city || defaults.city,
      titleKeywords:
        titleKeywords.length > 0 ? titleKeywords : defaults.titleKeywords,
    };
  }

  async getMaxParallelScrapes(): Promise<number> {
    const setting = SCRAPER_SETTINGS.maxParallelScrapes;
    return parseBoundedInteger(
      await this.source.getSetting(setting.key),
      setting.defaultValue,
      setting.minimum,
      setting.maximum
    );
  }

  async getKeepDeviceAwake(): Promise<boolean> {
    const value = await this.source.getSetting(
      SCRAPER_SETTINGS.keepDeviceAwake.key
    );
    return value === null
      ? SCRAPER_SETTINGS.keepDeviceAwake.defaultValue
      : value !== "false";
  }

  async getHistoryRetentionDays(): Promise<number> {
    const setting = SCRAPER_SETTINGS.historyRetentionDays;
    return parseBoundedInteger(
      await this.source.getSetting(setting.key),
      setting.defaultValue,
      setting.minimum,
      setting.maximum
    );
  }
}
