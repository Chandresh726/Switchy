import { z } from "zod";

import {
  HttpError,
  type IHttpClient,
} from "@/lib/scraper/infrastructure/http-client";
import type { IBrowserClient, BrowserSession } from "@/lib/scraper/infrastructure/browser-client";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import {
  parseExternalPayload,
  ScraperPayloadError,
  type ScraperResult,
  type ScrapeOptions,
  type ScrapedJob,
  type BrowserScraperConfig,
  type EarlyFilterStats,
  type JobFilters,
} from "@/lib/scraper/types";
import { processDescription, containsHtml } from "@/lib/jobs/description-processor";
import { parseEmploymentType } from "@/lib/scraper/types";
import { applyEarlyFilters, hasEarlyFilters, toEarlyFilterStats } from "@/lib/scraper/services";
import { AbstractBrowserScraper, DEFAULT_BROWSER_CONFIG } from "../core";

type WorkdayJobListItem = {
  title: string;
  externalPath: string;
  locationsText: string;
  postedOn: string;
  remoteType: string;
  bulletFields: string[];
};

type WorkdayJobListResponse = {
  total: number;
  jobPostings: WorkdayJobListItem[];
};

type WorkdayListFetchResult = {
  jobs: WorkdayJobListItem[];
  isComplete: boolean;
};

type WorkdayJobDetailResponse = {
  jobPostingInfo: {
    jobDescription: string;
    timeType: string;
    externalUrl: string;
  };
};

const WorkdayJobListResponseSchema = z
  .object({
    total: z.number(),
    jobPostings: z.array(
      z
        .object({
          title: z.string(),
          externalPath: z.string(),
          locationsText: z.string().default(""),
          postedOn: z.string().default(""),
          remoteType: z.string().default(""),
          bulletFields: z.array(z.string()).default([]),
        })
        .passthrough()
    ),
  })
  .passthrough();

const WorkdayJobDetailResponseSchema = z
  .object({
    jobPostingInfo: z
      .object({
        jobDescription: z.string().default(""),
        timeType: z.string().default(""),
        externalUrl: z.string().default(""),
      })
      .passthrough(),
  })
  .passthrough();

type WorkdaySession = BrowserSession & {
  csrfToken: string;
  tenant: string;
  board: string;
};

export type WorkdayConfig = BrowserScraperConfig & {
  parallelListFetches: number;
  detailBatchSize: number;
  listPageSize: number;
  requestDelayBaseMs: number;
  requestDelayJitterMs: number;
};

export const DEFAULT_WORKDAY_CONFIG: WorkdayConfig = {
  ...DEFAULT_BROWSER_CONFIG,
  parallelListFetches: 2,
  detailBatchSize: 5,
  listPageSize: 20,
  requestDelayBaseMs: 800,
  requestDelayJitterMs: 200,
};

export class WorkdayScraper extends AbstractBrowserScraper<WorkdayConfig> {
  readonly platform = "workday" as const;
  override readonly capabilities = {
    transport: "browser",
    concurrency: "serial",
    supportsCancellation: true,
  } as const;

  constructor(
    httpClient: IHttpClient,
    browserClient: IBrowserClient,
    config: Partial<WorkdayConfig> = {}
  ) {
    super(httpClient, browserClient, { ...DEFAULT_WORKDAY_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return (
      urlLower.includes("myworkdayjobs.com") ||
      /\.wd\d*\.myworkdayjobs\.com/.test(urlLower)
    );
  }

  extractIdentifier(url: string): string | null {
    const parsed = this.parseUrl(url);
    if (!parsed) return null;
    return `${parsed.tenant}/${parsed.board}`;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      let parsedUrl = this.parseUrl(url);
      let detectedBoardToken: string | undefined;

      if (options?.boardToken && options.boardToken.includes("/")) {
        const [tenant, board] = options.boardToken.split("/");
        const urlObj = new URL(url);
        parsedUrl = {
          baseUrl: `${urlObj.protocol}//${urlObj.hostname}`,
          tenant,
          board,
        };
      } else if (!parsedUrl) {
        return this.failure(
          "invalid_url",
          "Could not parse Workday URL. Expected format: https://company.wd5.myworkdayjobs.com/board"
        );
      } else {
        detectedBoardToken = `${parsedUrl.tenant}/${parsedUrl.board}`;
      }

      const session = await this.bootstrapSession(
        `${parsedUrl.baseUrl}/${parsedUrl.board}`
      );

      if (!session || !session.csrfToken || !session.cookies) {
        return this.failure(
          "auth_required",
          "Failed to establish session with Workday. The site may have bot protection enabled."
        );
      }

      console.log(`[Scraper] Unknown - Bootstrapped browser session (tenant: ${parsedUrl.tenant}/${parsedUrl.board})`);

      const workdaySession: WorkdaySession = {
        ...session,
        csrfToken: session.csrfToken,
        tenant: parsedUrl.tenant,
        board: parsedUrl.board,
      };

      const filters: JobFilters | undefined = options?.filters;
      const existingExternalIds = options?.existingExternalIds;

      const listResult = await this.fetchAllJobListItems(workdaySession);
      if (!listResult) {
        return this.failure("network_error", "Failed to fetch Workday jobs list.");
      }

      const allJobListItems = listResult.jobs;
      const openExternalIds = allJobListItems
        .map((job) => {
          const jobPostingId = this.getJobPostingId(job);
          if (!jobPostingId) return null;
          return this.generateExternalId(this.platform, workdaySession.board, jobPostingId);
        })
        .filter((externalId): externalId is string => Boolean(externalId));

      if (allJobListItems.length === 0) {
        if (!listResult.isComplete) {
          return this.failure(
            "parse_error",
            "Incomplete Workday list fetch with no usable job data."
          );
        }
        return {
          outcome: "success",
          jobs: [],
          totalListings: 0,
          detectedBoardToken,
          openExternalIds,
          listingCompleteness: "complete",
        };
      }

      let jobsToProcess = allJobListItems;
      let earlyFilterStats: EarlyFilterStats | undefined;

      if (hasEarlyFilters(filters)) {
        const filterableJobs = allJobListItems.map((job) => ({
          ...job,
          title: job.title,
          location: job.locationsText,
        }));

        const earlyFilterResult = applyEarlyFilters(filterableJobs, filters);
        const { filtered } = earlyFilterResult;
        jobsToProcess = filtered as WorkdayJobListItem[];
        earlyFilterStats = toEarlyFilterStats(earlyFilterResult);
      }

      if (jobsToProcess.length === 0) {
        const baseOutcome = listResult.isComplete ? "success" : "partial";
        return {
          outcome: baseOutcome,
          jobs: [],
          totalListings: allJobListItems.length,
          detectedBoardToken,
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          listingCompleteness: listResult.isComplete ? "complete" : "partial",
        };
      }

      let jobsToFetch = jobsToProcess;

      if (existingExternalIds && existingExternalIds.size > 0) {
        jobsToFetch = jobsToProcess.filter((job) => {
          const jobPostingId = this.getJobPostingId(job);
          if (!jobPostingId) return false;
          const externalId = this.generateExternalId(this.platform, workdaySession.board, jobPostingId);
          return !existingExternalIds.has(externalId);
        });
      }

      if (jobsToFetch.length === 0) {
        const baseOutcome = listResult.isComplete ? "success" : "partial";
        return {
          outcome: baseOutcome,
          jobs: [],
          totalListings: allJobListItems.length,
          detectedBoardToken,
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          listingCompleteness: listResult.isComplete ? "complete" : "partial",
        };
      }

      const scrapedJobs: ScrapedJob[] = [];
      let detailFailures = 0;

      for (let i = 0; i < jobsToFetch.length; i += this.config.detailBatchSize) {
        const batch = jobsToFetch.slice(i, i + this.config.detailBatchSize);
        const { jobs: batchJobs, failedDetails } = await this.processJobBatch(workdaySession, batch);
        detailFailures += failedDetails;
        const results = batchJobs;
        scrapedJobs.push(...results);

        if (i + this.config.detailBatchSize < jobsToFetch.length) {
          await this.delayWithJitter();
        }
      }

      const isPartial = detailFailures > 0 || !listResult.isComplete;
      return {
        outcome: isPartial ? "partial" : "success",
        jobs: scrapedJobs,
        totalListings: allJobListItems.length,
        detectedBoardToken,
        earlyFiltered: earlyFilterStats,
        openExternalIds,
        listingCompleteness: listResult.isComplete ? "complete" : "partial",
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  protected async bootstrapSession(url: string): Promise<BrowserSession | null> {
    return this.browserClient.bootstrap(url);
  }

  private parseUrl(url: string): { baseUrl: string; tenant: string; board: string } | null {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathParts = urlObj.pathname.split("/").filter(Boolean);

      let tenant: string;
      const localePattern = /^[a-z]{2}-[a-z]{2}$/i;

      const wdMatch = hostname.match(/([^.]+)\.wd\d*\.myworkdayjobs\.com/i);
      if (wdMatch) {
        tenant = wdMatch[1];
      } else if (hostname === "myworkdayjobs.com") {
        tenant = pathParts[0] || "";
      } else {
        return null;
      }

      let pathIndex = hostname === "myworkdayjobs.com" ? 1 : 0;

      if (pathParts[pathIndex] && localePattern.test(pathParts[pathIndex])) {
        pathIndex++;
      }

      const board = pathParts[pathIndex] || tenant;
      const baseUrl = `${urlObj.protocol}//${hostname}`;

      return { baseUrl, tenant, board };
    } catch {
      return null;
    }
  }

  private async fetchJobListPage(
    session: WorkdaySession,
    offset: number = 0,
    limit: number = this.config.listPageSize
  ): Promise<WorkdayJobListResponse | null> {
    const url = `${session.baseUrl}/wday/cxs/${session.tenant}/${session.board}/jobs`;

    try {
      const payload = await this.post<unknown>(
        url,
        {
          appliedFacets: {},
          limit,
          offset,
          searchText: "",
        },
        {
          Accept: "application/json",
          "Content-Type": "application/json",
          Cookie: session.cookies,
          "x-calypso-csrf-token": session.csrfToken,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        }
      );

      return parseExternalPayload(
        WorkdayJobListResponseSchema,
        payload,
        "Workday job list"
      );
    } catch (error) {
      if (error instanceof HttpError || error instanceof ScraperPayloadError) throw error;
      throwIfScrapeAborted(error);
      return null;
    }
  }

  private async fetchAllJobListItems(
    session: WorkdaySession
  ): Promise<WorkdayListFetchResult | null> {
    const firstBatch = await this.fetchJobListPage(session, 0, this.config.listPageSize);

    if (!firstBatch || !Array.isArray(firstBatch.jobPostings)) {
      return null;
    }

    const total = firstBatch.total || 0;
    const allJobs = [...firstBatch.jobPostings];
    let failedPages = 0;

    if (total > this.config.listPageSize) {
      const totalPages = Math.ceil(total / this.config.listPageSize);
      const offsets: number[] = [];

      for (let page = 1; page < totalPages; page++) {
        offsets.push(page * this.config.listPageSize);
      }

      const fetchWithDelay = async (offset: number, index: number): Promise<WorkdayJobListResponse | null> => {
        const staggerDelay = 300 + index * 400 + Math.floor(Math.random() * 200);
        await this.delay(staggerDelay);
        try {
          return await this.fetchJobListPage(session, offset, this.config.listPageSize);
        } catch (error) {
          throwIfScrapeAborted(error);
          return null;
        }
      };

      const batchSize = this.config.parallelListFetches;
      for (let i = 0; i < offsets.length; i += batchSize) {
        const batchOffsets = offsets.slice(i, i + batchSize);
        const results = await Promise.all(
          batchOffsets.map((offset, idx) => fetchWithDelay(offset, idx))
        );

        for (const result of results) {
          if (!result || !Array.isArray(result.jobPostings)) {
            failedPages++;
          } else {
            allJobs.push(...result.jobPostings);
          }
        }

        if (i + batchSize < offsets.length) {
          await this.delayWithJitter();
        }
      }
    }

    return {
      jobs: allJobs,
      isComplete: failedPages === 0 && allJobs.length >= total,
    };
  }

  private async fetchJobDetail(
    session: WorkdaySession,
    jobPostingId: string
  ): Promise<WorkdayJobDetailResponse | null> {
    const url = `${session.baseUrl}/wday/cxs/${session.tenant}/${session.board}/job/${jobPostingId}`;

    try {
      const payload = await this.fetch<unknown>(url, {
        Accept: "application/json",
        Cookie: session.cookies,
        "x-calypso-csrf-token": session.csrfToken,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      });

      return parseExternalPayload(
        WorkdayJobDetailResponseSchema,
        payload,
        "Workday job detail"
      );
    } catch (error) {
      throwIfScrapeAborted(error);
      return null;
    }
  }

  private async processJobBatch(
    session: WorkdaySession,
    jobs: WorkdayJobListItem[]
  ): Promise<{ jobs: ScrapedJob[]; failedDetails: number }> {
    let failedDetails = 0;
    const detailPromises = jobs.map(async (job) => {
      try {
        const jobPostingId = this.getJobPostingId(job);

        if (!jobPostingId) return null;

        const detail = await this.fetchJobDetail(session, jobPostingId);

        if (!detail?.jobPostingInfo) {
          failedDetails++;
          return null;
        }

        const externalId = this.generateExternalId(this.platform, session.board, jobPostingId);
        const jobUrl =
          detail.jobPostingInfo.externalUrl ||
          `${session.baseUrl}/${session.board}${job.externalPath || ""}`;
        const { description, descriptionFormat } = this.processJobDescription(
          detail.jobPostingInfo.jobDescription || ""
        );

        return {
          externalId,
          title: job.title,
          url: jobUrl,
          location: job.locationsText,
          locationType: this.parseRemoteType(job.remoteType),
          description,
          descriptionFormat,
          employmentType: parseEmploymentType(detail.jobPostingInfo.timeType),
          postedDate: this.parsePostedDate(job.postedOn),
        };
      } catch (error) {
        throwIfScrapeAborted(error);
        failedDetails++;
        return null;
      }
    });

    const results = await Promise.all(detailPromises);
    const successfulJobs: ScrapedJob[] = [];
    for (const result of results) {
      if (result) {
        successfulJobs.push(result);
      }
    }

    return {
      jobs: successfulJobs,
      failedDetails,
    };
  }

  private getJobPostingId(job: WorkdayJobListItem): string | null {
    const jobPostingId = job.externalPath?.split("/").pop() || job.bulletFields?.[1];
    return jobPostingId || null;
  }

  private processJobDescription(description: string): { description: string | undefined; descriptionFormat: "markdown" | "plain" } {
    if (!description) {
      return { description: undefined, descriptionFormat: "plain" };
    }

    if (containsHtml(description)) {
      const result = processDescription(description, "html");
      return {
        description: result.text ?? undefined,
        descriptionFormat: result.format,
      };
    }

    const result = processDescription(description, "plain");
    return {
      description: result.text ?? undefined,
      descriptionFormat: result.format,
    };
  }

  private parseRemoteType(remoteType: string): "remote" | "hybrid" | "onsite" | undefined {
    const type = remoteType?.toLowerCase();
    if (type === "remote") return "remote";
    if (type === "hybrid") return "hybrid";
    if (type && type !== "remote" && type !== "hybrid") return "onsite";
    return undefined;
  }

  private parsePostedDate(postedOn: string): Date | undefined {
    if (!postedOn) return undefined;

    const absoluteDate = new Date(postedOn);
    if (!isNaN(absoluteDate.getTime())) {
      return absoluteDate;
    }

    const cleaned = postedOn.replace(/^posted\s+(?:on\s+)?/i, "");

    const cleanedDate = new Date(cleaned);
    if (!isNaN(cleanedDate.getTime())) {
      return cleanedDate;
    }

    const match = cleaned.match(/(\d+)/);
    if (!match) return undefined;
    const days = parseInt(match[1], 10);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  private async delayWithJitter(): Promise<void> {
    const jitter =
      Math.floor(Math.random() * this.config.requestDelayJitterMs * 2) -
      this.config.requestDelayJitterMs;
    await this.delay(this.config.requestDelayBaseMs + jitter);
  }
}

export function createWorkdayScraper(
  httpClient: IHttpClient,
  browserClient: IBrowserClient,
  config?: Partial<WorkdayConfig>
): WorkdayScraper {
  return new WorkdayScraper(httpClient, browserClient, config);
}
