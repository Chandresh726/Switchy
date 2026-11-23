import { createHash } from "node:crypto";

import type { Page } from "playwright";
import { z } from "zod";

import { containsHtml, processDescription } from "@/lib/jobs/description-processor";
import type {
  BrowserSession,
  IBrowserClient,
} from "@/lib/scraper/infrastructure/browser-client";
import type { ScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state";
import { abortableDelay, getActiveScrapeSignal } from "@/lib/scraper/infrastructure/cancellation";
import { createFailureForHttpStatus } from "@/lib/scraper/types/validation";
import { BrowserSessionBootstrapError } from "@/lib/scraper/infrastructure/browser-session-error";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import {
  HttpError,
  type IHttpClient,
  type HttpRequestOptions,
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
import { KeyedExecutionLock } from "@/lib/scraper/runtime/keyed-lock";

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
  invalidFields: string[];
};

type WorkdayListFetchResult = {
  jobs: WorkdayJobListItem[];
  isComplete: boolean;
  advertisedCount: number;
  missingOffsets: number[];
  unidentifiedCount: number;
  invalidCount: number;
  invalidFields: string[];
  diagnostics: string[];
  resumed: boolean;
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
    locationsText: z.string().nullish().transform((value) => value ?? ""),
    postedOn: z.string().nullish().transform((value) => value ?? ""),
    remoteType: z.string().nullish().transform((value) => value ?? ""),
    bulletFields: z.array(z.string()).nullish().transform((value) => value ?? []),
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
  readonly requestOptions: HttpRequestOptions;
  bootstrap(): Promise<WorkdaySession>;
};

export type WorkdayConfig = BrowserScraperConfig & {
  parallelListFetches: number;
  detailBatchSize: number;
  listDelayMs: number;
};

const WORKDAY_PAGE_SIZE = 20;
const workdayLock = new KeyedExecutionLock<string>();

const DEFAULT_WORKDAY_CONFIG: WorkdayConfig = {
  ...DEFAULT_BROWSER_CONFIG,
  parallelListFetches: 1,
  detailBatchSize: 1,
  listDelayMs: 1_500,
};

export class WorkdayScraper extends AbstractBrowserScraper<WorkdayConfig> {
  readonly platform = "workday" as const;
  override readonly capabilities = {
    concurrency: "browser_limited",
  } as const;

  constructor(
    httpClient: IHttpClient,
    browserClient: IBrowserClient,
    config: Partial<WorkdayConfig> = {},
    private readonly state?: ScrapeFetchStateStore
  ) {
    super(httpClient, browserClient, { ...DEFAULT_WORKDAY_CONFIG, ...config });
  }

  extractIdentifier(url: string): string | null {
    const parsed = this.parseUrl(url);
    if (!parsed) return null;
    return `${parsed.tenant}/${parsed.board}`;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    const release = await workdayLock.acquire("workday", getActiveScrapeSignal() ?? new AbortController().signal);
    try {
      try {
        return await this.scrapeAttempt(url, options);
      } catch (error) {
        if (!(error instanceof HttpError) || !error.isBrowserChallenge) throw error;
        // Keep the browser alive for the entire retry, including detail requests.
        // Copying cookies back into Node fetch does not preserve a browser session.
        try {
          return await this.browserClient.withBrowser(async (page) => {
            const source = new URL(url);
            source.search = "";
            source.hash = "";
            const response = await page.goto(source.toString(), {
              waitUntil: "domcontentloaded", timeout: this.config.timeout,
            });
            if (response && (await response.allHeaders())["cf-mitigated"] === "challenge") {
              // Give the site's own browser checks a bounded opportunity to settle.
              await page.waitForTimeout(3_000);
            }
            return this.scrapeAttempt(url, options, page);
          });
        } catch (browserError) {
          throwIfScrapeAborted(browserError);
          return this.failure("browser_challenge",
            "Workday browser recovery could not complete after a browser challenge. Retry in a future run.");
        }
      }
    } finally {
      release();
    }
  }

  private async scrapeAttempt(url: string, options?: ScrapeOptions, page?: Page): Promise<ScraperResult> {
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

      const sessionController = this.createSessionController(parsedUrl, page);
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
        advertisedTotal: listResult.advertisedCount,
        detectedBoardToken,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds,
        listingCompleteness: listResult.isComplete ? "complete" : "partial",
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      if (error instanceof HttpError && error.isBrowserChallenge) throw error;
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
      if (cause.isBrowserChallenge) throw cause;
      return createFailureForHttpStatus(cause.status, error.describe(), cause.retryAfterMs);
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

  private createSessionController(source: WorkdaySource, page?: Page): WorkdaySessionController {
    let activeSession: WorkdaySession = {
      ...source,
      cookies: "",
      csrfToken: "",
    };
    let bootstrapInFlight: Promise<WorkdaySession> | null = null;
    let bootstrapAttempted = false;

    const transport: HttpRequestOptions["transport"] = page ? async (url, init) => {
      const headers = new Headers(init.headers);
      for (const name of ["cookie", "origin", "referer", "user-agent"]) headers.delete(name);
      const response = await page.evaluate(async ({ url, method, headers, body, timeout }) => {
        const result = await fetch(url, {
          method, headers, body, credentials: "same-origin", redirect: "error",
          signal: AbortSignal.timeout(timeout),
        });
        return { status: result.status, statusText: result.statusText,
          headers: Array.from(result.headers.entries()), body: await result.text() };
      }, { url, method: init.method, headers: Array.from(headers.entries()),
        body: typeof init.body === "string" ? init.body : undefined, timeout: this.config.timeout });
      return new Response(response.body || null, response);
    } : undefined;

    return {
      requestOptions: { transport, minIntervalMs: this.config.listDelayMs },
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
      if (!(error instanceof HttpError) || error.isBrowserChallenge ||
        controller.requestOptions.transport || (error.status !== 401 && error.status !== 403)) {
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
          this.createRequestHeaders(session, true),
          controller.requestOptions
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
        invalidFields: parsedItems.invalidFields,
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
    const source = controller.session;
    const key = `workday-pages:${createHash("sha256").update(JSON.stringify({
      baseUrl: source.baseUrl, tenant: source.tenant, board: source.board,
      searchText: source.searchText, appliedFacets: source.appliedFacets,
    })).digest("hex")}`;
    const checkpointSchema = z.object({
      createdAt: z.number(), total: z.number(),
      pages: z.array(z.tuple([z.number().int().nonnegative(), z.object({
        total: z.number(), jobPostings: z.array(WorkdayJobListItemSchema),
        invalidCount: z.number(), invalidFields: z.array(z.string()),
      })])),
    });
    const saved = checkpointSchema.safeParse(this.state?.get(key));
    const pages = new Map<number, WorkdayJobListResponse>();
    const diagnostics: string[] = [];
    const startedAt = Date.now();
    let firstBatch: WorkdayJobListResponse;
    try {
      firstBatch = await this.fetchJobListPage(controller, 0, WORKDAY_PAGE_SIZE);
    } catch (error) {
      if (error instanceof WorkdayListError) return error;
      throw error;
    }
    const total = firstBatch.total || 0;
    const checkpoint = saved.success && saved.data.total === total &&
      startedAt - saved.data.createdAt < 15 * 60_000 ? saved.data : null;
    if (checkpoint) {
      for (const [offset, page] of checkpoint.pages) pages.set(offset, page);
    }
    const resumed = pages.size > 0;
    const createdAt = checkpoint?.createdAt ?? startedAt;
    pages.set(0, firstBatch);
    const persist = () => this.state?.set(key, {
      createdAt, total, pages: Array.from(pages.entries()),
    }, new Date(createdAt + 15 * 60_000));
    persist();

    const missingOffsets = new Set<number>();
    for (let offset = 0; offset < total; offset += WORKDAY_PAGE_SIZE) {
      const page = pages.get(offset);
      if (!page || page.jobPostings.length < Math.min(WORKDAY_PAGE_SIZE, total - offset)) {
        missingOffsets.add(offset);
      }
    }
    let consecutiveFailures = 0;
    // One recovery pass for isolated failures; sustained failures stop the sweep.
    for (let pass = 0; pass < 2; pass++) {
      const offsets = [...missingOffsets];
      let stopped = false;
      for (let index = 0; index < offsets.length; index += this.config.parallelListFetches) {
        if (consecutiveFailures >= 3 || Date.now() - startedAt > 15 * 60_000) {
          diagnostics.push("Listing sweep stopped at its failure or time budget");
          stopped = true;
          break;
        }
        if (this.config.listDelayMs > 0) {
          await abortableDelay(this.config.listDelayMs, getActiveScrapeSignal());
        }
        const batch = offsets.slice(index, index + this.config.parallelListFetches);
        const results = await Promise.all(batch.map(async (offset) => {
          try {
            return { offset, page: await this.fetchJobListPage(controller, offset, WORKDAY_PAGE_SIZE) };
          } catch (error) {
            throwIfScrapeAborted(error);
            return { offset, error };
          }
        }));
        // Save successful peers before propagating a throttle or bootstrap error.
        for (const result of results) {
          if (result.page) {
            pages.set(result.offset, result.page);
            consecutiveFailures = 0;
            if (result.page.jobPostings.length >= Math.min(WORKDAY_PAGE_SIZE, total - result.offset)) {
              missingOffsets.delete(result.offset);
            }
          } else {
            consecutiveFailures++;
            const error = result.error;
            diagnostics.push(error instanceof WorkdayListError ? error.describe() : "Listing page request failed");
          }
        }
        persist();
        const fatal = results.find(({ error }) => error instanceof WorkdayListError &&
          (error.status === 429 || error.stage === "bootstrap" ||
            (error.cause instanceof HttpError && error.cause.isBrowserChallenge)));
        if (fatal?.error) {
          if (fatal.error instanceof WorkdayListError && fatal.error.cause instanceof HttpError &&
            fatal.error.cause.isBrowserChallenge) throw fatal.error.cause;
          if (fatal.error instanceof WorkdayListError && fatal.error.status === 429 && this.state) {
            return fatal.error;
          }
          if (fatal.error instanceof WorkdayListError && fatal.error.stage === "bootstrap") throw fatal.error;
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }

    const jobsById = new Map<string, WorkdayJobListItem>();
    for (const [offset, page] of pages) {
      for (const [index, job] of page.jobPostings.entries()) {
        const id = this.getJobPostingId(job);
        const identity = id ?? `unkeyed-${offset + index}`;
        jobsById.set(id ? `id:${id}` : `offset:${offset + index}`, { ...job, listingIdentity: identity });
      }
    }
    const jobs = [...jobsById.values()];
    const invalidCount = [...pages.values()].reduce((sum, page) => sum + page.invalidCount, 0);
    const unidentifiedCount = jobs.filter((job) => !this.getJobPostingId(job)).length;
    const { isComplete: countsComplete } = resolveListingCompleteness(jobs.length, total);
    // A checkpoint mixes snapshots. Keep archival disabled until a fresh complete sweep.
    const isComplete = !resumed && missingOffsets.size === 0 && countsComplete &&
      invalidCount === 0 && unidentifiedCount === 0;
    if (missingOffsets.size === 0) this.state?.delete(key);
    return {
      jobs, isComplete, advertisedCount: total,
      missingOffsets: [...missingOffsets].sort((a, b) => a - b),
      unidentifiedCount, invalidCount,
      invalidFields: [...new Set([...pages.values()].flatMap((page) => page.invalidFields))].slice(0, 3),
      diagnostics: [...new Set(diagnostics)].slice(0, 3), resumed,
    };
  }

  private async fetchJobDetail(
    controller: WorkdaySessionController,
    jobPostingId: string
  ): Promise<WorkdayJobDetailResponse | null> {
    try {
      const payload = await this.withSessionFallback(controller, (session) => {
        const url = `${session.baseUrl}/wday/cxs/${session.tenant}/${session.board}/job/${jobPostingId}`;
        return this.fetch<unknown>(url, this.createRequestHeaders(session), controller.requestOptions);
      });

      return parseExternalPayload(
        WorkdayJobDetailResponseSchema,
        payload,
        "Workday job detail"
      );
    } catch (error) {
      if (error instanceof HttpError && (error.isBrowserChallenge || error.status === 429)) throw error;
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
        if (error instanceof BrowserSessionBootstrapError ||
          (error instanceof HttpError && (error.isBrowserChallenge || error.status === 429))) throw error;
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
        ? `; ${result.invalidCount} malformed listing${result.invalidCount === 1 ? " was" : "s were"} discarded; invalid fields: ${result.invalidFields.join(", ")}`
        : "";
    return createScraperError(
      "network_error",
      `Workday listings were only partially fetched (${result.jobs.length} of ${result.advertisedCount} advertised jobs; ${result.missingOffsets.length} page offset${result.missingOffsets.length === 1 ? "" : "s"} unresolved${unidentifiedSuffix}${invalidSuffix}).${result.resumed ? " Recovered listing checkpoint; archival deferred until a fresh complete sweep." : ""}${result.diagnostics.length ? ` Page failures: ${result.diagnostics.join("; ")}.` : ""}`
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
