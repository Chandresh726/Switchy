import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { parseEmploymentType } from "@/lib/scraper/types";
import { processDescription } from "@/lib/jobs/description-processor";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig } from "../core/types";

interface AshbyJob {
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  department?: string;
  team?: string;
  isRemote?: boolean;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  employmentType?: string;
  jobUrl?: string;
  applyUrl?: string;
}

interface AshbyResponse {
  apiVersion: string;
  jobs: AshbyJob[];
}

export type AshbyConfig = ApiScraperConfig;

export const DEFAULT_ASHBY_CONFIG: AshbyConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://api.ashbyhq.com",
};

export class AshbyScraper extends AbstractApiScraper<AshbyConfig> {
  readonly platform = "ashby" as const;

  constructor(
    httpClient: IHttpClient,
    config: Partial<AshbyConfig> = {}
  ) {
    super(httpClient, { ...DEFAULT_ASHBY_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    if (urlLower.includes("jobs.ashbyhq.com")) {
      return true;
    }
    return false;
  }

  extractIdentifier(url: string): string | null {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
      if (!path) return null;
      const [boardName] = path.split("/");
      return boardName || null;
    } catch {
      return null;
    }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const boardName = options?.boardToken || this.extractIdentifier(url);
      const detectedBoardToken = !options?.boardToken && boardName ? boardName : undefined;

      if (!boardName) {
        return {
          success: false,
          jobs: [],
          error:
            "Could not determine Ashby job board name from URL. Please provide the board token (jobs page name) manually.",
        };
      }

      const apiUrl = `${this.config.baseUrl}/posting-api/job-board/${encodeURIComponent(
        boardName
      )}?includeCompensation=true`;

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
          error: `Failed to fetch Ashby jobs: ${response.status}`,
        };
      }

      const data = (await response.json()) as AshbyResponse;
      return this.parseJobs(data, boardName, detectedBoardToken);
    } catch (error) {
      return {
        success: false,
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private parseJobs(
    data: AshbyResponse,
    boardName: string,
    detectedBoardToken?: string
  ): ScraperResult {
    const jobs: ScrapedJob[] = data.jobs.map((job, index) => {
      const primaryLocation =
        job.location ||
        job.secondaryLocations?.[0]?.location ||
        (job.isRemote ? "Remote" : undefined);

      const { location, locationType } = this.normalizeLocation(primaryLocation);

      let description: string | undefined;
      let descriptionFormat: "markdown" | "plain" | "html" = "plain";

      if (job.descriptionHtml) {
        const processed = processDescription(job.descriptionHtml, "html");
        description = processed.text ?? undefined;
        descriptionFormat = processed.format;
      } else if (job.descriptionPlain) {
        description = job.descriptionPlain;
        descriptionFormat = "plain";
      }

      const employmentType = parseEmploymentType(
        job.employmentType === "FullTime"
          ? "full-time"
          : job.employmentType === "PartTime"
            ? "part-time"
            : job.employmentType === "Intern"
              ? "intern"
              : job.employmentType === "Contract"
                ? "contract"
                : job.employmentType === "Temporary"
                  ? "temporary"
                  : job.employmentType
      );

      const externalId = this.generateExternalId(
        this.platform,
        boardName,
        job.jobUrl || job.applyUrl || index
      );

      return {
        externalId,
        title: job.title,
        url: job.jobUrl || job.applyUrl || "",
        location,
        locationType,
        department: job.team || job.department,
        description,
        descriptionFormat,
        employmentType,
        postedDate: job.publishedAt ? new Date(job.publishedAt) : undefined,
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

export function createAshbyScraper(
  httpClient: IHttpClient,
  config?: Partial<AshbyConfig>
): AshbyScraper {
  return new AshbyScraper(httpClient, config);
}
