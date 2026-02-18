export type {
  IScraper,
  ScraperConfig,
  ApiScraperConfig,
  BrowserScraperConfig,
  ScrapeOptions,
  JobFilters,
  ScraperResult,
  ScrapedJob,
  ScraperMetadata,
} from "./types";

export interface EarlyFilterStats {
  total: number;
  country?: number;
  city?: number;
  title?: number;
}

export {
  DEFAULT_SCRAPER_CONFIG,
  DEFAULT_API_CONFIG,
  DEFAULT_BROWSER_CONFIG,
} from "./types";

export { AbstractApiScraper } from "./api-scraper";
export { AbstractBrowserScraper } from "./browser-scraper";
