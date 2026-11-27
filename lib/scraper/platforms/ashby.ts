import { z } from "zod";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import {
  createScraperError,
  parseEmploymentType,
  parseExternalItems,
  parseExternalPayload,
} from "@/lib/scraper/types";
import { processDescription } from "@/lib/jobs/description-processor";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import { parseSourceDate, parseWorkplaceType, readAddressCountry, sourceCountryHint, sourceLocations } from "./shared/source-fields";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig } from "../core/types";

type AshbyJob = z.infer<typeof AshbyJobSchema>;

interface AshbyResponse {
  jobs: AshbyJob[];
}

const AshbyJobSchema = z
  .object({
    title: z.string().min(1),
    id: z.string().nullish(),
    isListed: z.boolean().nullish(),
    workplaceType: z.string().nullish(),
    compensation: z.object({
      scrapeableCompensationSalarySummary: z.string().nullish(),
      compensationTierSummary: z.string().nullish(),
    }).passthrough().nullish(),
    location: z.string().nullish(),
    secondaryLocations: z
      .array(z.object({ location: z.string().nullish() }).passthrough())
      .nullish(),
    department: z.string().nullish(),
    team: z.string().nullish(),
    isRemote: z.boolean().nullish(),
    descriptionHtml: z.string().nullish(),
    descriptionPlain: z.string().nullish(),
    publishedAt: z.string().nullish(),
    employmentType: z.string().nullish(),
    jobUrl: z.string().nullish(),
    applyUrl: z.string().nullish(),
  })
  .passthrough().refine((job) => Boolean(job.jobUrl || job.applyUrl), { path: ["jobUrl"], message: "A job URL is required" });

const AshbyResponseSchema = z
  .object({
    apiVersion: z.unknown().optional(),
    jobs: z.array(z.unknown()),
  })
  .passthrough();

export type AshbyConfig = ApiScraperConfig;

const DEFAULT_ASHBY_CONFIG: AshbyConfig = {
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

      if (!boardName) {
        return this.failure(
          "invalid_url",
          "Could not determine Ashby job board name from URL. Please provide the board token (jobs page name) manually."
        );
      }

      const decodedBoardName = this.safeDecodeBoardName(boardName).trim();
      const boardCandidates = Array.from(
        new Set([
          decodedBoardName,
          decodedBoardName.replace(/\s+/g, "-"),
        ])
      ).filter(Boolean);
      let response: Response | null = null;
      for (const candidate of boardCandidates) {
        const apiUrl = `${this.config.baseUrl}/posting-api/job-board/${encodeURIComponent(
          candidate
        )}?includeCompensation=true`;
        response = await this.fetchResponse(apiUrl, {
          headers: this.jsonRequestHeaders(),
        });
        if (response.ok || response.status !== 404) break;
      }

      if (!response) return this.failure("network_error", "Ashby did not return a response.");
      if (!response.ok) {
        return this.failureForResponse(
          response,
          `Failed to fetch Ashby jobs: ${response?.status ?? "unknown"}`
        );
      }

      const payload = parseExternalPayload(
        AshbyResponseSchema,
        await response.json(),
        "Ashby"
      );
      const parsedJobs = parseExternalItems(
        AshbyJobSchema,
        payload.jobs,
        "Ashby jobs"
      );
      return this.parseJobs(
        { jobs: parsedJobs.items },
        boardName,
        !options?.boardToken ? boardName : undefined,
        payload.jobs.length,
        parsedJobs.invalidCount
      );
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private safeDecodeBoardName(boardName: string): string {
    try {
      return decodeURIComponent(boardName);
    } catch {
      return boardName;
    }
  }

  private parseJobs(
    data: AshbyResponse,
    boardName: string,
    detectedBoardToken: string | undefined,
    totalListings: number,
    invalidJobs: number
  ): ScraperResult {
    const jobs: ScrapedJob[] = data.jobs.filter((job) => job.isListed !== false).map((job) => {
      const locations = sourceLocations([job.location, ...(job.secondaryLocations ?? []).map((item) => item.location)]);
      const country = sourceCountryHint([
        readAddressCountry(job.address),
        ...(job.secondaryLocations ?? []).map((item) => readAddressCountry(item.address)),
      ], locations);
      const normalized = this.normalizeLocation(locations.join("; ") || (job.isRemote ? "Remote" : undefined));
      const locationType = parseWorkplaceType(job.workplaceType) ?? (job.isRemote ? "remote" : normalized.locationType);

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
                  : job.employmentType ?? undefined
      );

      const externalId = this.generateExternalId(
        this.platform,
        boardName,
        job.jobUrl || job.applyUrl || job.id || ""
      );

      return {
        externalId,
        title: job.title,
        url: job.jobUrl || job.applyUrl || "",
        location: normalized.location,
        country,
        locations,
        locationType,
        salary: job.compensation?.scrapeableCompensationSalarySummary || job.compensation?.compensationTierSummary || undefined,
        department: job.team || job.department || undefined,
        description,
        descriptionFormat,
        employmentType,
        postedDate: parseSourceDate(job.publishedAt),
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
                `${invalidJobs} Ashby job${invalidJobs === 1 ? " was" : "s were"} skipped because required fields were invalid.`
              ),
            ]
          : undefined,
    };
  }
}
