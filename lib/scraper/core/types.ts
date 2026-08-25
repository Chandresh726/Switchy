import type { Platform } from "../types";
import type { ScraperConfig, ScrapeOptions, ApiScraperConfig, BrowserScraperConfig } from "../types/config";
import type { ScraperResult } from "../types/result";
import type { ScrapedJob } from "../types/job";

export type {
  ScraperConfig,
  ScrapeOptions,
  ApiScraperConfig,
  BrowserScraperConfig,
  ScraperResult,
  ScrapedJob,
};

export interface ScraperCapabilities {
  transport: "http" | "browser";
  concurrency: "parallel" | "browser_limited";
  supportsCancellation: boolean;
}

export interface IScraper<
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TScraperConfig extends ScraperConfig = ScraperConfig
> {
  readonly platform: Platform;
  readonly requiresBrowser: boolean;
  readonly capabilities: ScraperCapabilities;

  validate(url: string): boolean;
  scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult>;
  extractIdentifier(url: string): string | null;
}

export { DEFAULT_API_CONFIG, DEFAULT_BROWSER_CONFIG } from "../types/config";
