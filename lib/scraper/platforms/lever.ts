import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { parseEmploymentType } from "@/lib/scraper/types";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig } from "../core/types";

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  categories: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
  };
  descriptionPlain?: string;
  createdAt: number;
}

export type LeverConfig = ApiScraperConfig;

export const DEFAULT_LEVER_CONFIG: LeverConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://api.lever.co",
};

export class LeverScraper extends AbstractApiScraper<LeverConfig> {
  readonly platform = "lever" as const;

  constructor(
    httpClient: IHttpClient,
    config: Partial<LeverConfig> = {}
  ) {
    super(httpClient, { ...DEFAULT_LEVER_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return urlLower.includes("lever.co") || urlLower.includes("jobs.lever");
  }

  extractIdentifier(url: string): string | null {
    const patterns = [
      /jobs\.lever\.co\/([^\/\?]+)/i,
      /([^\.]+)\.lever\.co/i,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1] && match[1] !== "jobs") {
        return match[1];
      }
    }

    return null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const companySlug = options?.boardToken || this.extractIdentifier(url);
      const detectedBoardToken = !options?.boardToken && companySlug ? companySlug : undefined;

      if (!companySlug) {
        return {
          success: false,
          jobs: [],
          error: "Could not extract company slug from URL. Please provide the board token manually.",
        };
      }

      const apiUrl = `${this.config.baseUrl}/v0/postings/${companySlug}?mode=json`;

      const response = await this.httpClient.fetch(apiUrl, {
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          jobs: [],
          error: `Failed to fetch jobs: ${response.status}`,
        };
      }

      const data: LeverJob[] = await response.json();
      return this.parseJobs(data, companySlug, detectedBoardToken);
    } catch (error) {
      return {
        success: false,
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private parseJobs(
    data: LeverJob[],
    companySlug: string,
    detectedBoardToken?: string
  ): ScraperResult {
    const jobs: ScrapedJob[] = data.map((job) => {
      const { location, locationType } = this.normalizeLocation(
        job.categories?.location
      );

      return {
        externalId: this.generateExternalId(this.platform, companySlug, job.id),
        title: job.text,
        url: job.hostedUrl,
        location,
        locationType,
        department: job.categories?.team || job.categories?.department,
        employmentType: parseEmploymentType(job.categories?.commitment),
        description: job.descriptionPlain,
        descriptionFormat: "plain",
        postedDate: job.createdAt ? new Date(job.createdAt) : undefined,
      };
    });

    const openExternalIds = jobs.map((job) => job.externalId);

    return {
      success: true,
      jobs,
      detectedBoardToken,
      openExternalIds,
      openExternalIdsComplete: true,
    };
  }
}

export function createLeverScraper(
  httpClient: IHttpClient,
  config?: Partial<LeverConfig>
): LeverScraper {
  return new LeverScraper(httpClient, config);
}
