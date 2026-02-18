import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { processDescription, containsHtml, decodeHtmlEntities } from "@/lib/jobs/description-processor";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig } from "../core/types";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string };
  departments: { name: string }[];
  updated_at: string;
  content?: string;
  metadata?: { name: string; value: string | string[] }[];
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export type GreenhouseConfig = ApiScraperConfig;

export const DEFAULT_GREENHOUSE_CONFIG: GreenhouseConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://boards-api.greenhouse.io",
};

export class GreenhouseScraper extends AbstractApiScraper<GreenhouseConfig> {
  readonly platform = "greenhouse" as const;

  constructor(
    httpClient: IHttpClient,
    config: Partial<GreenhouseConfig> = {}
  ) {
    super(httpClient, { ...DEFAULT_GREENHOUSE_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return (
      urlLower.includes("greenhouse.io") ||
      urlLower.includes("boards.greenhouse")
    );
  }

  extractIdentifier(url: string): string | null {
    const patterns = [
      /boards\.greenhouse\.io\/([^\/\?]+)/i,
      /job-boards\.greenhouse\.io\/([^\/\?]+)/i,
      /([^\.]+)\.greenhouse\.io/i,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1] && match[1] !== "boards" && match[1] !== "job-boards") {
        return match[1];
      }
    }

    return null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const boardToken = options?.boardToken || this.extractIdentifier(url);
      const detectedBoardToken = !options?.boardToken && boardToken ? boardToken : undefined;

      if (!boardToken) {
        return {
          success: false,
          jobs: [],
          error: "Could not extract board token from URL. Please provide the board token manually.",
        };
      }

      const apiUrl = `${this.config.baseUrl}/v1/boards/${boardToken}/jobs?content=true`;

      const response = await this.httpClient.fetch(apiUrl, {
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      let data: GreenhouseResponse;

      if (!response.ok) {
        const altApiUrl = `https://boards.greenhouse.io/${boardToken}/embed/job_board/jobs.json`;
        const altResponse = await this.httpClient.fetch(altApiUrl, {
          timeout: this.config.timeout,
          retries: this.config.retries,
          baseDelay: this.config.baseDelay,
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
          },
        });

        if (!altResponse.ok) {
          return {
            success: false,
            jobs: [],
            error: `Failed to fetch jobs: ${response.status}`,
          };
        }

        data = await altResponse.json();
      } else {
        data = await response.json();
      }

      return this.parseJobs(data, boardToken, detectedBoardToken);
    } catch (error) {
      return {
        success: false,
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private parseJobs(
    data: GreenhouseResponse,
    boardToken: string,
    detectedBoardToken?: string
  ): ScraperResult {
    const jobs: ScrapedJob[] = data.jobs.map((job) => {
      const locationMetadata = job.metadata?.find((m) => {
        const nameLower = m.name.toLowerCase();
        return nameLower.includes("location");
      });
      const actualLocations = locationMetadata?.value || [];
      const metadataLocation = Array.isArray(actualLocations)
        ? actualLocations.join(", ")
        : typeof actualLocations === "string"
          ? actualLocations
          : "";

      const originalLocation = job.location?.name || "";
      const locationParts = [originalLocation, metadataLocation].filter(Boolean);
      const combinedLocation = locationParts.join(", ");

      const { location, locationType } = this.normalizeLocation(combinedLocation);

      let description: string | undefined;
      let descriptionFormat: "markdown" | "plain" = "plain";

      if (job.content) {
        const decodedContent = decodeHtmlEntities(job.content);

        if (containsHtml(decodedContent)) {
          const result = processDescription(decodedContent, "html");
          description = result.text ?? undefined;
          descriptionFormat = result.format;
        } else {
          description = decodedContent;
          descriptionFormat = "markdown";
        }
      }

      return {
        externalId: this.generateExternalId(this.platform, boardToken, job.id),
        title: job.title,
        url: job.absolute_url,
        location,
        locationType,
        department: job.departments?.[0]?.name,
        description,
        descriptionFormat,
        postedDate: job.updated_at ? new Date(job.updated_at) : undefined,
      };
    });

    return {
      success: true,
      jobs,
      detectedBoardToken,
    };
  }
}

export function createGreenhouseScraper(
  httpClient: IHttpClient,
  config?: Partial<GreenhouseConfig>
): GreenhouseScraper {
  return new GreenhouseScraper(httpClient, config);
}
