import { z } from "zod";

import { containsHtml, processDescription } from "@/lib/jobs/description-processor";
import type {
  BrowserSession,
  IBrowserClient,
} from "@/lib/scraper/infrastructure/browser-client";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import {
  HttpError,
  type IHttpClient,
} from "@/lib/scraper/infrastructure/http-client";
import {
  createScraperError,
  parseEmploymentType,
  parseExternalPayload,
  ScraperPayloadError,
  type BrowserScraperConfig,
  type ScrapeOptions,
  type ScraperError,
  type ScrapedJob,
  type ScraperResult,
} from "@/lib/scraper/types";
import { AbstractBrowserScraper, DEFAULT_BROWSER_CONFIG } from "../core";
import { selectListingsForHydration } from "./shared/listing-selection";

type WorkdayJobListItem = {
  title: string;
  externalPath: string;
  locationsText: string;
  postedOn: string;
  remoteType: string;
  bulletFields: string[];
  listingIdentity?: string;
};

type WorkdayJobListResponse = {
  total: number;
  jobPostings: WorkdayJobListItem[];
};

type WorkdayListFetchResult = {
  jobs: WorkdayJobListItem[];
  isComplete: boolean;
  advertisedCount: number;
  missingOffsets: number[];
  unidentifiedCount: number;
  session: WorkdaySession;
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

      const refreshSession = async (): Promise<WorkdaySession | null> => {
        try {
          const refreshed = await this.bootstrapSession(
            `${parsedUrl.baseUrl}/${parsedUrl.board}`
          );
          if (!refreshed?.csrfToken || !refreshed.cookies) return null;
          return {
            ...refreshed,
            csrfToken: refreshed.csrfToken,
            tenant: parsedUrl.tenant,
            board: parsedUrl.board,
          };
        } catch (error) {
          throwIfScrapeAborted(error);
          return null;
        }
      };

      const listResult = await this.fetchAllJobListItems(
        workdaySession,
        refreshSession
      );
      if (!listResult) {
        return this.failure("network_error", "Failed to fetch Workday jobs list.");
      }

      const allJobListItems = listResult.jobs;
      const activeSession = listResult.session;
      const openExternalIds = allJobListItems.map((job) =>
        this.generateExternalId(
          this.platform,
          activeSession.board,
          this.getListingIdentity(job)
        )
      );

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

      const selection = selectListingsForHydration({
        listings: allJobListItems,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (job) => ({
          title: job.title,
          location: job.locationsText,
        }),
        getExternalId: (job) => {
          return this.generateExternalId(
            this.platform,
            activeSession.board,
            this.getListingIdentity(job)
          );
        },
      });
      const jobsToFetch = selection.listings;

      if (jobsToFetch.length === 0) {
        const baseOutcome = listResult.isComplete ? "success" : "partial";
        const issues = listResult.isComplete
          ? undefined
          : [this.createListIssue(listResult)];
        return {
          outcome: baseOutcome,
          jobs: [],
          totalListings: allJobListItems.length,
          detectedBoardToken,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingCompleteness: listResult.isComplete ? "complete" : "partial",
          issues,
        };
      }

      const scrapedJobs: ScrapedJob[] = [];
      const failedDetailJobs: WorkdayJobListItem[] = [];

      for (let i = 0; i < jobsToFetch.length; i += this.config.detailBatchSize) {
        const batch = jobsToFetch.slice(i, i + this.config.detailBatchSize);
        const { jobs: batchJobs, failedJobs } = await this.processJobBatch(
          activeSession,
          batch
        );
        failedDetailJobs.push(...failedJobs);
        scrapedJobs.push(...batchJobs);

        if (i + this.config.detailBatchSize < jobsToFetch.length) {
          await this.delayWithJitter();
        }
      }

      let unresolvedDetailJobs = failedDetailJobs;
      if (failedDetailJobs.length > 0) {
        const refreshedSession = await refreshSession();
        if (refreshedSession) {
          unresolvedDetailJobs = [];
          for (
            let i = 0;
            i < failedDetailJobs.length;
            i += this.config.detailBatchSize
          ) {
            const retryBatch = failedDetailJobs.slice(
              i,
              i + this.config.detailBatchSize
            );
            const retryResult = await this.processJobBatch(
              refreshedSession,
              retryBatch
            );
            scrapedJobs.push(...retryResult.jobs);
            unresolvedDetailJobs.push(...retryResult.failedJobs);

            if (i + this.config.detailBatchSize < failedDetailJobs.length) {
              await this.delayWithJitter();
            }
          }
        }
      }

      scrapedJobs.push(
        ...unresolvedDetailJobs.map((job) =>
          this.mapListingFallback(activeSession, job)
        )
      );

      const isPartial = unresolvedDetailJobs.length > 0 || !listResult.isComplete;
      const issues: ScraperError[] = [];
      if (!listResult.isComplete) issues.push(this.createListIssue(listResult));
      if (unresolvedDetailJobs.length > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${unresolvedDetailJobs.length} Workday job detail request${unresolvedDetailJobs.length === 1 ? "" : "s"} failed after session refresh; listing data was retained.`
          )
        );
      }
      return {
        outcome: isPartial ? "partial" : "success",
        jobs: scrapedJobs,
        totalListings: allJobListItems.length,
        detectedBoardToken,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds,
        listingCompleteness: listResult.isComplete ? "complete" : "partial",
        issues: issues.length > 0 ? issues : undefined,
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
    session: WorkdaySession,
    refreshSession: () => Promise<WorkdaySession | null>
  ): Promise<WorkdayListFetchResult | null> {
    const fetchSafely = async (activeSession: WorkdaySession, offset: number) => {
      try {
        return await this.fetchJobListPage(
          activeSession,
          offset,
          this.config.listPageSize
        );
      } catch (error) {
        if (error instanceof ScraperPayloadError) throw error;
        throwIfScrapeAborted(error);
        return null;
      }
    };

    let activeSession = session;
    let sessionRefreshed = false;
    const refreshOnce = async () => {
      if (sessionRefreshed) return null;
      sessionRefreshed = true;
      return refreshSession();
    };
    let firstBatch = await fetchSafely(activeSession, 0);

    if (!firstBatch || !Array.isArray(firstBatch.jobPostings)) {
      const refreshed = await refreshOnce();
      if (!refreshed) return null;
      activeSession = refreshed;
      firstBatch = await fetchSafely(activeSession, 0);
    }

    if (!firstBatch || !Array.isArray(firstBatch.jobPostings)) {
      return null;
    }

    const total = firstBatch.total || 0;
    const jobsById = new Map<string, WorkdayJobListItem>();
    const addJobs = (jobs: WorkdayJobListItem[], offset: number) => {
      for (let index = 0; index < jobs.length; index++) {
        const job = jobs[index];
        if (!job) continue;
        const jobPostingId = this.getJobPostingId(job);
        const listingIdentity =
          jobPostingId ?? `unkeyed-${offset + index}`;
        const key = jobPostingId
          ? `id:${jobPostingId}`
          : `offset:${offset + index}`;
        jobsById.set(key, { ...job, listingIdentity });
      }
    };
    addJobs(firstBatch.jobPostings, 0);
    const missingOffsets = new Set<number>();
    if (firstBatch.jobPostings.length < Math.min(this.config.listPageSize, total)) {
      missingOffsets.add(0);
    }

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
          return await this.fetchJobListPage(activeSession, offset, this.config.listPageSize);
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

        for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
          const result = results[resultIndex];
          const offset = batchOffsets[resultIndex];
          if (offset === undefined) continue;
          if (!result || !Array.isArray(result.jobPostings)) {
            missingOffsets.add(offset);
          } else {
            addJobs(result.jobPostings, offset);
            const expectedCount = Math.min(this.config.listPageSize, total - offset);
            if (result.jobPostings.length < expectedCount) {
              missingOffsets.add(offset);
            }
          }
        }

        if (i + batchSize < offsets.length) {
          await this.delayWithJitter();
        }
      }
    }

    if (missingOffsets.size > 0) {
      const retrySession = sessionRefreshed ? activeSession : await refreshOnce();
      if (retrySession) {
        activeSession = retrySession;
        for (const offset of Array.from(missingOffsets).sort((a, b) => a - b)) {
          const result = await fetchSafely(activeSession, offset);
          if (!result || !Array.isArray(result.jobPostings)) continue;

          addJobs(result.jobPostings, offset);
          const expectedCount = Math.min(this.config.listPageSize, total - offset);
          if (result.jobPostings.length >= expectedCount) {
            missingOffsets.delete(offset);
          }
        }
      }
    }

    const allJobs = Array.from(jobsById.values());
    const unidentifiedCount = allJobs.filter(
      (job) => !this.getJobPostingId(job)
    ).length;
    if (allJobs.length >= total) {
      missingOffsets.clear();
    }

    return {
      jobs: allJobs,
      isComplete:
        missingOffsets.size === 0 &&
        allJobs.length >= total &&
        unidentifiedCount === 0,
      advertisedCount: total,
      missingOffsets: Array.from(missingOffsets).sort((a, b) => a - b),
      unidentifiedCount,
      session: activeSession,
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
  ): Promise<{ jobs: ScrapedJob[]; failedJobs: WorkdayJobListItem[] }> {
    const failedJobs: WorkdayJobListItem[] = [];
    const detailPromises = jobs.map(async (job) => {
      try {
        const jobPostingId = this.getJobPostingId(job);

        if (!jobPostingId) {
          failedJobs.push(job);
          return null;
        }

        const detail = await this.fetchJobDetail(session, jobPostingId);

        if (!detail?.jobPostingInfo) {
          failedJobs.push(job);
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
        failedJobs.push(job);
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
      failedJobs,
    };
  }

  private mapListingFallback(
    session: WorkdaySession,
    job: WorkdayJobListItem
  ): ScrapedJob {
    const jobPostingId = this.getListingIdentity(job);
    return {
      externalId: this.generateExternalId(
        this.platform,
        session.board,
        jobPostingId
      ),
      title: job.title,
      url: `${session.baseUrl}/${session.board}${job.externalPath || ""}`,
      location: job.locationsText,
      locationType: this.parseRemoteType(job.remoteType),
      postedDate: this.parsePostedDate(job.postedOn),
    };
  }

  private createListIssue(result: WorkdayListFetchResult): ScraperError {
    const unidentifiedSuffix =
      result.unidentifiedCount > 0
        ? `; ${result.unidentifiedCount} listing${result.unidentifiedCount === 1 ? "" : "s"} lacked a stable Workday ID`
        : "";
    return createScraperError(
      "network_error",
      `Workday listings were only partially fetched (${result.jobs.length} of ${result.advertisedCount} advertised jobs; ${result.missingOffsets.length} page offset${result.missingOffsets.length === 1 ? "" : "s"} unresolved${unidentifiedSuffix}).`
    );
  }

  private getListingIdentity(job: WorkdayJobListItem): string {
    return this.getJobPostingId(job) ?? job.listingIdentity ?? "unkeyed";
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
