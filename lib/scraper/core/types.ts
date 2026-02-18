import type { Platform } from "../types";
import type { ScraperConfig, ScrapeOptions, JobFilters, ApiScraperConfig, BrowserScraperConfig } from "../types/config";
import type { ScraperResult, EarlyFilterStats } from "../types/result";
import type { ScrapedJob } from "../types/job";

export type {
  ScraperConfig,
  ScrapeOptions,
  JobFilters,
  ApiScraperConfig,
  BrowserScraperConfig,
  ScraperResult,
  EarlyFilterStats,
  ScrapedJob,
};

export interface IScraper<
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TScraperConfig extends ScraperConfig = ScraperConfig
> {
  readonly platform: Platform;
  readonly requiresBrowser: boolean;
  
  validate(url: string): boolean;
  scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult>;
  extractIdentifier(url: string): string | null;
}

export interface ScraperMetadata {
  detectedBoardToken?: string;
  platform: Platform;
  durationMs: number;
  jobsFiltered?: number;
}

export { DEFAULT_SCRAPER_CONFIG, DEFAULT_API_CONFIG, DEFAULT_BROWSER_CONFIG } from "../types/config";
