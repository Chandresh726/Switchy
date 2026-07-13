import { z } from "zod";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { processDescription, containsHtml, decodeHtmlEntities } from "@/lib/jobs/description-processor";
import {
  createScraperError,
  parseExternalItems,
  parseExternalPayload,
} from "@/lib/scraper/types";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig } from "../core/types";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string | null } | null;
  departments?: { name?: string | null }[] | null;
  updated_at?: string | null;
  content?: string | null;
  metadata?: { name?: string | null; value?: unknown }[] | null;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

const GreenhouseJobSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    absolute_url: z.string(),
    location: z
      .object({ name: z.string().nullish() })
      .passthrough()
      .nullish(),
    departments: z
      .array(z.object({ name: z.string().nullish() }).passthrough())
      .nullish(),
    updated_at: z.string().nullish(),
    content: z.string().nullish(),
    metadata: z
      .array(
        z
          .object({
            name: z.string().nullish(),
            value: z.unknown().optional(),
          })
          .passthrough()
      )
      .nullish(),
  })
  .passthrough();

const GreenhouseResponseSchema = z
  .object({
    jobs: z.array(z.unknown()),
  })
  .passthrough();

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
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname.toLowerCase();
      const firstPathSegment = parsedUrl.pathname.split("/").filter(Boolean)[0];

      const isBoardsHost = /^boards(?:\.[^.]+)?\.greenhouse\.io$/i.test(hostname);
      const isJobBoardsHost = /^job-boards(?:\.[^.]+)?\.greenhouse\.io$/i.test(hostname);

      if ((isBoardsHost || isJobBoardsHost) && firstPathSegment) {
        return decodeURIComponent(firstPathSegment);
      }

      const greenhouseSubdomainMatch = hostname.match(/^([^.]+)\.greenhouse\.io$/i);
      if (greenhouseSubdomainMatch?.[1]) {
        const subdomain = greenhouseSubdomainMatch[1].toLowerCase();
        if (subdomain !== "boards" && subdomain !== "job-boards") {
          return subdomain;
        }
      }
    } catch {
      // Fall through to regex parsing for non-standard input.
    }

    const patterns = [
      /boards(?:\.[^\/\.]+)?\.greenhouse\.io\/([^\/\?]+)/i,
      /job-boards(?:\.[^\/\.]+)?\.greenhouse\.io\/([^\/\?]+)/i,
      /(?:https?:\/\/)?([^\.\/\?]+)\.greenhouse\.io/i,
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
        return this.failure(
          "invalid_url",
          "Could not extract board token from URL. Please provide the board token manually."
        );
      }

      const apiUrl = `${this.config.baseUrl}/v1/boards/${boardToken}/jobs?content=true`;

      const response = await this.fetchResponse(apiUrl, {
        headers: this.jsonRequestHeaders(),
      });

      let payload: { jobs: unknown[] };

      if (!response.ok) {
        const altApiUrl = `https://boards.greenhouse.io/${boardToken}/embed/job_board/jobs.json`;
        const altResponse = await this.fetchResponse(altApiUrl, {
          headers: this.jsonRequestHeaders(),
        });

        if (!altResponse.ok) {
          return this.failureForHttpStatus(
            altResponse.status,
            `Failed to fetch jobs: ${altResponse.status}`
          );
        }

        payload = parseExternalPayload(
          GreenhouseResponseSchema,
          await altResponse.json(),
          "Greenhouse"
        );
      } else {
        payload = parseExternalPayload(
          GreenhouseResponseSchema,
          await response.json(),
          "Greenhouse"
        );
      }

      const parsedJobs = parseExternalItems(
        GreenhouseJobSchema,
        payload.jobs,
        "Greenhouse jobs"
      );
      return this.parseJobs(
        { jobs: parsedJobs.items },
        boardToken,
        detectedBoardToken,
        payload.jobs.length,
        parsedJobs.invalidCount
      );
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private parseJobs(
    data: GreenhouseResponse,
    boardToken: string,
    detectedBoardToken: string | undefined,
    totalListings: number,
    invalidJobs: number
  ): ScraperResult {
    const jobs: ScrapedJob[] = data.jobs.map((job) => {
      const locationMetadata = job.metadata?.find((m) => {
        const nameLower = m.name?.toLowerCase() ?? "";
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
        department: job.departments?.[0]?.name ?? undefined,
        description,
        descriptionFormat,
        postedDate: job.updated_at ? new Date(job.updated_at) : undefined,
      };
    });

    const openExternalIds = jobs.map((job) => job.externalId);

    return {
      outcome: invalidJobs > 0 ? "partial" : "success",
      jobs,
      totalListings,
      detectedBoardToken,
      openExternalIds,
      listingCompleteness: invalidJobs > 0 ? "partial" : "complete",
      issues:
        invalidJobs > 0
          ? [
              createScraperError(
                "parse_error",
                `${invalidJobs} Greenhouse job${invalidJobs === 1 ? " was" : "s were"} skipped because required fields were invalid.`
              ),
            ]
          : undefined,
    };
  }
}
