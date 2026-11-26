export interface JobFilters {
  country?: string;
  city?: string;
  titleKeywords?: string[];
}

export interface ScrapeOptions {
  boardToken?: string;
  filters?: JobFilters;
  existingExternalIds?: Set<string>;
  /** Fresh existing jobs keyed by URL, for sources whose requisition ID needs details. */
  existingJobUrls?: ReadonlySet<string>;
  detailRefresh?: {
    fetchedAtByIdentity: ReadonlyMap<string, number>;
    limit: number;
  };
  signal?: AbortSignal;
}

export interface ScraperConfig {
  timeout: number;
  retries: number;
  baseDelay: number;
}

export interface ApiScraperConfig extends ScraperConfig {
  baseUrl: string;
}

export interface BrowserScraperConfig extends ScraperConfig {
  headless: boolean;
  sessionTimeout: number;
}

const DEFAULT_SCRAPER_CONFIG: Omit<ScraperConfig, never> = {
  timeout: 30000,
  retries: 3,
  baseDelay: 1000,
};

export const DEFAULT_API_CONFIG: Omit<ApiScraperConfig, "baseUrl"> = {
  ...DEFAULT_SCRAPER_CONFIG,
};

export const DEFAULT_BROWSER_CONFIG: Omit<BrowserScraperConfig, never> = {
  ...DEFAULT_SCRAPER_CONFIG,
  headless: true,
  sessionTimeout: 60000,
};
