export interface ScrapedJob {
  externalId: string;
  title: string;
  url: string;
  location?: string;
  locationType?: "remote" | "hybrid" | "onsite";
  department?: string;
  description?: string;
  descriptionFormat?: "markdown" | "plain" | "html";
  salary?: string;
  employmentType?: string;
  postedDate?: Date;
}

export interface ScraperResult {
  success: boolean;
  jobs: ScrapedJob[];
  error?: string;
}

export interface ScrapeOptions {
  boardToken?: string; // Manual board token for platforms like Greenhouse
}

export interface BaseScraper {
  platform: string;
  scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult>;
  validate(url: string): boolean;
}

export abstract class AbstractScraper implements BaseScraper {
  abstract platform: string;
  abstract scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult>;
  abstract validate(url: string): boolean;

  protected normalizeLocation(location: string | undefined): {
    location?: string;
    locationType?: "remote" | "hybrid" | "onsite";
  } {
    if (!location) return {};

    const locationLower = location.toLowerCase();

    let locationType: "remote" | "hybrid" | "onsite" | undefined;
    if (locationLower.includes("remote")) {
      locationType = "remote";
    } else if (locationLower.includes("hybrid")) {
      locationType = "hybrid";
    } else if (location.trim()) {
      locationType = "onsite";
    }

    return {
      location: location.trim(),
      locationType,
    };
  }

  protected generateExternalId(platform: string, ...parts: (string | number | undefined)[]): string {
    const validParts = parts.filter((p) => p !== undefined && p !== null);
    return `${platform}-${validParts.join("-")}`;
  }

  protected async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries = 3,
    backoff = 1000
  ): Promise<Response> {
    try {
      const response = await fetch(url, options);

      // Return immediately if successful
      if (response.ok) return response;

      // Don't retry client errors (except 429 Too Many Requests)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return response;
      }

      if (retries <= 0) return response;

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, backoff));

      return this.fetchWithRetry(url, options, retries - 1, backoff * 2);
    } catch (error) {
      if (retries <= 0) throw error;

      await new Promise((resolve) => setTimeout(resolve, backoff));
      return this.fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
  }
}
