import { z } from "zod";

import { containsHtml, processDescription } from "@/lib/jobs/description-processor";
import type {
  BrowserSession,
  IBrowserClient,
} from "@/lib/scraper/infrastructure/browser-client";
import { BrowserSessionBootstrapError } from "@/lib/scraper/infrastructure/browser-session-error";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import {
  HttpError,
  type IHttpClient,
} from "@/lib/scraper/infrastructure/http-client";
import {
  createScraperError,
  parseEmploymentType,
  parseExternalItems,
  parseExternalPayload,
  ScraperPayloadError,
  type BrowserScraperConfig,
  type ScrapeOptions,
  type ScraperError,
  type ScraperErrorResult,
  type ScrapedJob,
  type ScraperResult,
} from "@/lib/scraper/types";
import { AbstractBrowserScraper, DEFAULT_BROWSER_CONFIG } from "../core";
import {
  isDetailFailuresTolerable,
  resolveListingCompleteness,
} from "./shared/completeness";
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
  invalidCount: number;
};

type WorkdayListFetchResult = {
  jobs: WorkdayJobListItem[];
  isComplete: boolean;
  advertisedCount: number;
  missingOffsets: number[];
  unidentifiedCount: number;
  invalidCount: number;
};

type WorkdayListFetchStage = "bootstrap" | "list-page";

class WorkdayListError extends Error {
  constructor(
    readonly stage: WorkdayListFetchStage,
    readonly offset: number,
    message: string,
    readonly status?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "WorkdayListError";
  }

  describe(): string {
    const statusSuffix = this.status !== undefined ? `, HTTP ${this.status}` : "";
    return `Failed to fetch Workday jobs list (stage=${this.stage}, offset=${this.offset}${statusSuffix}): ${this.message}`;
  }
}

type WorkdayJobDetailResponse = {
  jobPostingInfo: {
    jobDescription: string;
    timeType: string;
    externalUrl: string;
  };
};

const WorkdayJobListItemSchema = z
  .object({
    title: z.string(),
    externalPath: z.string(),
    locationsText: z.string().default(""),
    postedOn: z.string().default(""),
    remoteType: z.string().default(""),
    bulletFields: z.array(z.string()).default([]),
  })
  .passthrough();

const WorkdayJobListEnvelopeSchema = z
  .object({
    total: z.number(),
    jobPostings: z.array(z.unknown()),
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

type WorkdaySource = {
  baseUrl: string;
  tenant: string;
  board: string;
  searchText: string;
  appliedFacets: Record<string, string[]>;
};

type WorkdaySession = WorkdaySource & {
  cookies: string;
  csrfToken: string;
};

type WorkdaySessionController = {
  readonly session: WorkdaySession;
  bootstrap(): Promise<WorkdaySession>;
};

export type WorkdayConfig = BrowserScraperConfig & {
  parallelListFetches: number;
  detailBatchSize: number;
};

const WORKDAY_PAGE_SIZE = 20;

const DEFAULT_WORKDAY_CONFIG: WorkdayConfig = {
  ...DEFAULT_BROWSER_CONFIG,
  parallelListFetches: 6,
  detailBatchSize: 5,
};

export class WorkdayScraper extends AbstractBrowserScraper<WorkdayConfig> {
  readonly platform = "workday" as const;
  override readonly capabilities = {
    transport: "browser",
    concurrency: "browser_limited",
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
        if (!tenant || !board) {
          return this.failure("invalid_url", "Invalid Workday board token.");
        }
        const sourceUrl = new URL(url);
        const sourceScope = this.parseSourceScope(sourceUrl);
        parsedUrl = {
          baseUrl: `${sourceUrl.protocol}//${sourceUrl.hostname}`,
          tenant,
          board,
          ...sourceScope,
        };
      } else if (!parsedUrl) {
        return this.failure(
          "invalid_url",
          "Could not parse Workday URL. Expected format: https://company.wd5.myworkdayjobs.com/board"
        );
      } else {
        detectedBoardToken = `${parsedUrl.tenant}/${parsedUrl.board}`;
      }

      const sessionController = this.createSessionController(parsedUrl);
      const listResult = await this.fetchAllJobListItems(sessionController);
      if (listResult instanceof WorkdayListError) {
        return this.toListFailure(listResult);
      }

      const allJobListItems = listResult.jobs;
      const openExternalIds = allJobListItems.map((job) =>
        this.generateExternalId(
          this.platform,
          parsedUrl.board,
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
            parsedUrl.board,
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
          sessionController,
          batch
        );
        failedDetailJobs.push(...failedJobs);
        scrapedJobs.push(...batchJobs);
      }

      let unresolvedDetailJobs = failedDetailJobs;
      if (failedDetailJobs.length > 0) {
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
            sessionController,
            retryBatch
          );
          scrapedJobs.push(...retryResult.jobs);
          unresolvedDetailJobs.push(...retryResult.failedJobs);
        }
      }

      scrapedJobs.push(
        ...unresolvedDetailJobs.map((job) =>
          this.mapListingFallback(parsedUrl, job)
        )
      );

      // jobsToFetch is the attempted hydration count (unresolved details
      // are retained as listing fallbacks inside scrapedJobs).
      const isPartial =
        !listResult.isComplete ||
        !isDetailFailuresTolerable(unresolvedDetailJobs.length, jobsToFetch.length);
      const issues: ScraperError[] = [];
      if (!listResult.isComplete) issues.push(this.createListIssue(listResult));
      if (unresolvedDetailJobs.length > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${unresolvedDetailJobs.length} Workday job detail request${unresolvedDetailJobs.length === 1 ? "" : "s"} failed after retry; listing data was retained.`
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

  /**
   * Preserves the underlying failure classification (HTTP status codes,
   * payload errors) instead of collapsing everything to `network_error`, so
   * unfixable failures (auth, parse) don't burn queue retries while
   * transient ones (5xx, bootstrap) still do.
   */
  private toListFailure(error: WorkdayListError): ScraperErrorResult {
    const cause = error.cause;
    if (cause instanceof BrowserSessionBootstrapError) {
      return this.failure("browser_error", error.describe());
    }
    if (cause instanceof HttpError) {
      return this.failureForHttpStatus(cause.status, error.describe());
    }
    if (cause instanceof ScraperPayloadError) {
      return this.failure("parse_error", error.describe());
    }
    return this.failure("network_error", error.describe());
  }

  private parseUrl(url: string): WorkdaySource | null {
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

      return {
        baseUrl,
        tenant,
        board,
        ...this.parseSourceScope(urlObj),
      };
    } catch {
      return null;
    }
  }

  private parseSourceScope(url: URL): Pick<WorkdaySource, "searchText" | "appliedFacets"> {
    const searchText = url.searchParams.get("q") ?? url.searchParams.get("searchText") ?? "";
    const appliedFacets: Record<string, string[]> = {};
    const excluded = new Set([
      "page",
      "offset",
      "limit",
      "q",
      "searchtext",
      "locale",
      "source",
      "src",
    ]);

    for (const [key, value] of url.searchParams) {
      const normalizedKey = key.toLowerCase();
      if (excluded.has(normalizedKey) || normalizedKey.startsWith("utm_")) {
        continue;
      }
      (appliedFacets[key] ??= []).push(value);
    }

    return { searchText, appliedFacets };
  }

  private createSessionController(source: WorkdaySource): WorkdaySessionController {
    let activeSession: WorkdaySession = {
      ...source,
      cookies: "",
      csrfToken: "",
    };
    let bootstrapInFlight: Promise<WorkdaySession> | null = null;
    let bootstrapAttempted = false;

    return {
      get session() {
        return activeSession;
      },
      bootstrap: async () => {
        if (activeSession.cookies && activeSession.csrfToken) return activeSession;
        if (bootstrapInFlight) return bootstrapInFlight;
        if (bootstrapAttempted) {
          throw new BrowserSessionBootstrapError("session_extraction");
        }

        bootstrapAttempted = true;
        const request = this.bootstrapSession(`${source.baseUrl}/${source.board}`).then(
          (browserSession) => {
            if (!browserSession?.cookies || !browserSession.csrfToken) {
              throw new BrowserSessionBootstrapError("session_extraction");
            }
            activeSession = {
              ...source,
              cookies: browserSession.cookies,
              csrfToken: browserSession.csrfToken,
            };
            return activeSession;
          }
        );
        bootstrapInFlight = request;
        try {
          return await request;
        } finally {
          if (bootstrapInFlight === request) bootstrapInFlight = null;
        }
      },
    };
  }

  private async withSessionFallback<T>(
    controller: WorkdaySessionController,
    request: (session: WorkdaySession) => Promise<T>
  ): Promise<T> {
    try {
      return await request(controller.session);
    } catch (error) {
      if (!(error instanceof HttpError) || (error.status !== 401 && error.status !== 403)) {
        throw error;
      }
      const session = await controller.bootstrap();
      return request(session);
    }
  }

  private async fetchJobListPage(
    controller: WorkdaySessionController,
    offset: number = 0,
    limit: number = WORKDAY_PAGE_SIZE
  ): Promise<WorkdayJobListResponse> {
    try {
      const payload = await this.withSessionFallback(controller, (session) => {
        const url = `${session.baseUrl}/wday/cxs/${session.tenant}/${session.board}/jobs`;
        return this.post<unknown>(
          url,
          {
            appliedFacets: session.appliedFacets,
            limit,
            offset,
            searchText: session.searchText,
          },
          this.createRequestHeaders(session, true)
        );
      });

      const envelope = parseExternalPayload(
        WorkdayJobListEnvelopeSchema,
        payload,
        "Workday job list"
      );
      const parsedItems = parseExternalItems(
        WorkdayJobListItemSchema,
        envelope.jobPostings,
        "Workday job list items"
      );
      return {
        total: envelope.total,
        jobPostings: parsedItems.items,
        invalidCount: parsedItems.invalidCount,
      };
    } catch (error) {
      throwIfScrapeAborted(error);
      if (error instanceof WorkdayListError) throw error;
      if (error instanceof BrowserSessionBootstrapError) {
        throw new WorkdayListError(
          "bootstrap",
          offset,
          error.message,
          undefined,
          { cause: error }
        );
      }
      if (error instanceof HttpError) {
        throw new WorkdayListError("list-page", offset, error.message, error.status, {
          cause: error,
        });
      }
      throw new WorkdayListError(
        "list-page",
        offset,
        error instanceof Error ? error.message : "Unknown list fetch error",
        undefined,
        { cause: error }
      );
    }
  }

  private async fetchAllJobListItems(
    controller: WorkdaySessionController
  ): Promise<WorkdayListFetchResult | WorkdayListError> {
    const fetchSafely = async (offset: number) => {
      try {
        return await this.fetchJobListPage(
          controller,
          offset,
          WORKDAY_PAGE_SIZE
        );
      } catch (error) {
        // A broken session cannot be salvaged per-offset; fail the board.
        if (error instanceof WorkdayListError && error.stage === "bootstrap") throw error;
        if (error instanceof BrowserSessionBootstrapError) throw error;
        if (error instanceof ScraperPayloadError) throw error;
        throwIfScrapeAborted(error);
        return null;
      }
    };

    let firstBatch: WorkdayJobListResponse;
    try {
      firstBatch = await this.fetchJobListPage(controller, 0, WORKDAY_PAGE_SIZE);
    } catch (error) {
      if (error instanceof WorkdayListError) return error;
      throw error;
    }

    const total = firstBatch.total || 0;
    const jobsById = new Map<string, WorkdayJobListItem>();
    const invalidCountByOffset = new Map<number, number>([
      [0, firstBatch.invalidCount],
    ]);
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
    if (firstBatch.jobPostings.length < Math.min(WORKDAY_PAGE_SIZE, total)) {
      missingOffsets.add(0);
    }

    if (total > WORKDAY_PAGE_SIZE) {
      const totalPages = Math.ceil(total / WORKDAY_PAGE_SIZE);
      const offsets: number[] = [];

      for (let page = 1; page < totalPages; page++) {
        offsets.push(page * WORKDAY_PAGE_SIZE);
      }

      const fetchPage = async (offset: number): Promise<WorkdayJobListResponse | null> => {
        try {
          return await this.fetchJobListPage(controller, offset, WORKDAY_PAGE_SIZE);
        } catch (error) {
          if (error instanceof WorkdayListError && error.stage === "bootstrap") throw error;
          if (error instanceof BrowserSessionBootstrapError) throw error;
          throwIfScrapeAborted(error);
          return null;
        }
      };

      const batchSize = this.config.parallelListFetches;
      for (let i = 0; i < offsets.length; i += batchSize) {
        const batchOffsets = offsets.slice(i, i + batchSize);
        const results = await Promise.all(
          batchOffsets.map((offset) => fetchPage(offset))
        );

        for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
          const result = results[resultIndex];
          const offset = batchOffsets[resultIndex];
          if (offset === undefined) continue;
          if (!result || !Array.isArray(result.jobPostings)) {
            missingOffsets.add(offset);
          } else {
            invalidCountByOffset.set(offset, result.invalidCount);
            addJobs(result.jobPostings, offset);
            const expectedCount = Math.min(WORKDAY_PAGE_SIZE, total - offset);
            if (result.jobPostings.length < expectedCount) {
              missingOffsets.add(offset);
            }
          }
        }

      }
    }

    if (missingOffsets.size > 0) {
      for (const offset of Array.from(missingOffsets).sort((a, b) => a - b)) {
        const result = await fetchSafely(offset);
        if (!result || !Array.isArray(result.jobPostings)) continue;

        invalidCountByOffset.set(offset, result.invalidCount);
        addJobs(result.jobPostings, offset);
        const expectedCount = Math.min(WORKDAY_PAGE_SIZE, total - offset);
        if (result.jobPostings.length >= expectedCount) {
          missingOffsets.delete(offset);
        }
      }
    }

    const allJobs = Array.from(jobsById.values());
    const unidentifiedCount = allJobs.filter(
      (job) => !this.getJobPostingId(job)
    ).length;
    const invalidCount = Array.from(invalidCountByOffset.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    if (allJobs.length >= total && invalidCount === 0) {
      missingOffsets.clear();
    }
    // Invalid listings are already excluded from `allJobs`, so they count
    // toward the tolerated gap instead of failing the board on their own.
    // Unidentified listings stay a hard failure: without a stable Workday ID
    // they cannot be deduplicated or archived safely.
    const { isComplete: countsComplete } = resolveListingCompleteness(
      allJobs.length,
      total
    );

    return {
      jobs: allJobs,
      isComplete:
        missingOffsets.size === 0 &&
        countsComplete &&
        unidentifiedCount === 0,
      advertisedCount: total,
      missingOffsets: Array.from(missingOffsets).sort((a, b) => a - b),
      unidentifiedCount,
      invalidCount,
    };
  }

  private async fetchJobDetail(
    controller: WorkdaySessionController,
    jobPostingId: string
  ): Promise<WorkdayJobDetailResponse | null> {
    try {
      const payload = await this.withSessionFallback(controller, (session) => {
        const url = `${session.baseUrl}/wday/cxs/${session.tenant}/${session.board}/job/${jobPostingId}`;
        return this.fetch<unknown>(url, this.createRequestHeaders(session));
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
    controller: WorkdaySessionController,
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

        const detail = await this.fetchJobDetail(controller, jobPostingId);

        if (!detail?.jobPostingInfo) {
          failedJobs.push(job);
          return null;
        }

        const session = controller.session;
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
        if (error instanceof BrowserSessionBootstrapError) throw error;
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
    session: WorkdaySource,
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

  private createRequestHeaders(
    session: WorkdaySession,
    includeContentType = false
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    };
    if (includeContentType) headers["Content-Type"] = "application/json";
    if (session.cookies) headers.Cookie = session.cookies;
    if (session.csrfToken) {
      headers["x-calypso-csrf-token"] = session.csrfToken;
    }
    return headers;
  }

  private createListIssue(result: WorkdayListFetchResult): ScraperError {
    const unidentifiedSuffix =
      result.unidentifiedCount > 0
        ? `; ${result.unidentifiedCount} listing${result.unidentifiedCount === 1 ? "" : "s"} lacked a stable Workday ID`
        : "";
    const invalidSuffix =
      result.invalidCount > 0
        ? `; ${result.invalidCount} malformed listing${result.invalidCount === 1 ? " was" : "s were"} discarded`
        : "";
    return createScraperError(
      "network_error",
      `Workday listings were only partially fetched (${result.jobs.length} of ${result.advertisedCount} advertised jobs; ${result.missingOffsets.length} page offset${result.missingOffsets.length === 1 ? "" : "s"} unresolved${unidentifiedSuffix}${invalidSuffix}).`
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

}
