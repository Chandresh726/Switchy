import type { Page } from "playwright";
import { z } from "zod";

import { containsHtml, processDescription } from "@/lib/jobs/description-processor";
import type {
  BrowserSession,
  IBrowserClient,
} from "@/lib/scraper/infrastructure/browser-client";
import type { ScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state";
import { getActiveScrapeSignal, throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import { createFailureForHttpStatus } from "@/lib/scraper/types/validation";
import { BrowserSessionBootstrapError } from "@/lib/scraper/infrastructure/browser-session-error";
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
  type ScrapeOptions,
  type ScraperError,
  type ScraperErrorResult,
  type ScrapedJob,
  type ScraperResult,
} from "@/lib/scraper/types";
import { KeyedExecutionLock } from "@/lib/runtime/keyed-lock";
import { measureScrapeMetric } from "@/lib/scraper/infrastructure/metrics";

import { AbstractBrowserScraper } from "../core";
import { matchesPreferredCountry } from "../services/filter-service";
import { isDetailFailuresTolerable } from "./shared/completeness";
import { selectListingsForHydration } from "./shared/listing-selection";

import {
  DEFAULT_WORKDAY_CONFIG,
  WORKDAY_PAGE_SIZE,
  type WorkdayConfig,
  type WorkdayConfigInput,
} from "./workday/config";
import {
  canonicalWorkdayScope, discoverWorkdayCountryPlan, readWorkdayFacets, resolveWorkdayCountryPolicy,
  type WorkdayCountryPlan,
} from "./workday/country-filter";
import { crawlWorkdayListings } from "./workday/listing-crawler";
import { WorkdayListError } from "./workday/listing-error";
import {
  WorkdayJobDetailResponseSchema, WorkdayJobListEnvelopeSchema, WorkdayJobListItemSchema,
  type WorkdayJobDetailResponse, type WorkdayJobListItem, type WorkdayJobListResponse,
  type WorkdayListFetchResult, type WorkdaySession, type WorkdaySessionController, type WorkdaySource,
} from "./workday/payloads";

export type { WorkdayConfig, WorkdayConfigInput } from "./workday/config";

const workdayLock = new KeyedExecutionLock<string>();

export class WorkdayScraper extends AbstractBrowserScraper<WorkdayConfig> {
  readonly platform = "workday" as const;
  override readonly capabilities = {
    concurrency: "browser_limited",
  } as const;

  constructor(
    httpClient: IHttpClient,
    browserClient: IBrowserClient,
    config: WorkdayConfigInput = {},
    private readonly state?: ScrapeFetchStateStore
  ) {
    const bounded = (value: number | undefined, fallback: number, minimum: number, maximum: number) =>
      Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.floor(value!))) : fallback;
    super(httpClient, browserClient, {
      ...DEFAULT_WORKDAY_CONFIG, ...config,
      parallelListFetches: bounded(config.parallelListFetches, DEFAULT_WORKDAY_CONFIG.parallelListFetches, 1, 6),
      detailBatchSize: bounded(config.detailBatchSize, DEFAULT_WORKDAY_CONFIG.detailBatchSize, 1, 6),
      listDelayMs: bounded(config.listDelayMs, DEFAULT_WORKDAY_CONFIG.listDelayMs, 0, 60_000),
      queryResultLimit: bounded(config.queryResultLimit, DEFAULT_WORKDAY_CONFIG.queryResultLimit, 20, 2000),
      countryFilter: { ...DEFAULT_WORKDAY_CONFIG.countryFilter, ...config.countryFilter,
        aliases: { ...DEFAULT_WORKDAY_CONFIG.countryFilter.aliases, ...config.countryFilter?.aliases } },
      adaptivePacing: { ...DEFAULT_WORKDAY_CONFIG.adaptivePacing, ...config.adaptivePacing },
    });
  }

  extractIdentifier(url: string): string | null {
    const parsed = this.parseUrl(url);
    if (!parsed) return null;
    return `${parsed.tenant}/${parsed.board}`;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    const release = await measureScrapeMetric("platformLockWaitMs", () =>
      workdayLock.acquire("workday", getActiveScrapeSignal() ?? new AbortController().signal));
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
      const listResult = await this.fetchAllJobListItems(sessionController, options);
      if (listResult instanceof WorkdayListError) {
        return this.toListFailure(listResult);
      }

      const allJobListItems = listResult.jobs;
      const listingScopeKey = listResult.scopeKey;
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
          advertisedTotal: listResult.advertisedCount,
          detectedBoardToken,
          openExternalIds,
          listingCompleteness: "complete",
          listingScopeKey,
        };
      }

      const listingJobs: ScrapedJob[] = allJobListItems.map((item) => this.mapListingFallback(parsedUrl, item, listResult.country));
      const selection = selectListingsForHydration({
        listings: allJobListItems,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        existingJobUrls: options?.existingJobUrls,
        getUrl: (job) => `${parsedUrl.baseUrl}/${parsedUrl.board}${job.externalPath || ""}`,
        detailRefresh: options?.detailRefresh,
        toFilterable: (job) => ({
          title: job.title,
          location: job.locationsText,
          country: listResult.country,
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
        const issues = listResult.isComplete && allJobListItems.length >= listResult.advertisedCount
          ? undefined
          : [this.createListIssue(listResult)];
        return {
          outcome: baseOutcome,
          jobs: [],
          listingJobs,
          totalListings: allJobListItems.length,
          advertisedTotal: listResult.advertisedCount,
          detectedBoardToken,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingCompleteness: listResult.isComplete ? "complete" : "partial",
          listingScopeKey,
          issues,
        };
      }

      const scrapedJobs: ScrapedJob[] = [];
      const failedDetailJobs: WorkdayJobListItem[] = [];

      for (let i = 0; i < jobsToFetch.length; i += this.config.detailBatchSize) {
        const batch = jobsToFetch.slice(i, i + this.config.detailBatchSize);
        const { jobs: batchJobs, failedJobs } = await this.processJobBatch(
          sessionController,
          batch, listResult.country
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
            retryBatch, listResult.country
          );
          scrapedJobs.push(...retryResult.jobs);
          unresolvedDetailJobs.push(...retryResult.failedJobs);
        }
      }

      scrapedJobs.push(
        ...unresolvedDetailJobs.map((job) =>
          this.mapListingFallback(parsedUrl, job, listResult.country)
        )
      );

      // jobsToFetch is the attempted hydration count (unresolved details
      // are retained as listing fallbacks inside scrapedJobs).
      const isPartial =
        !listResult.isComplete ||
        !isDetailFailuresTolerable(unresolvedDetailJobs.length, jobsToFetch.length);
      const issues: ScraperError[] = [];
      if (!listResult.isComplete || allJobListItems.length < listResult.advertisedCount) issues.push(this.createListIssue(listResult));
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
        listingJobs,
        totalListings: allJobListItems.length,
        advertisedTotal: listResult.advertisedCount,
        detectedBoardToken,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds,
        listingCompleteness: listResult.isComplete ? "complete" : "partial",
        listingScopeKey,
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
      requestOptions: { transport, minIntervalMs: this.config.listDelayMs, adaptivePacing: this.config.adaptivePacing },
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
        facets: readWorkdayFacets(envelope.facets),
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
    controller: WorkdaySessionController,
    options?: ScrapeOptions
  ): Promise<WorkdayListFetchResult | WorkdayListError> {
    const run = async (current: WorkdaySessionController, initialPage?: WorkdayJobListResponse) => {
      const result = await crawlWorkdayListings({
        source: current.session, state: this.state, initialPage,
        request: (offset) => this.fetchJobListPage(current, offset),
        getId: (job) => this.getJobPostingId(job),
        parallelListFetches: this.config.parallelListFetches,
        queryResultLimit: this.config.queryResultLimit,
      });
      if (!(result instanceof WorkdayListError)) result.scopeKey = canonicalWorkdayScope(current.session);
      return result;
    };
    let first: WorkdayJobListResponse;
    try { first = await this.fetchJobListPage(controller); }
    catch (error) {
      if (error instanceof WorkdayListError) return error;
      throw error;
    }
    const policy = resolveWorkdayCountryPolicy(controller.session, this.config.countryFilter, this.config.boardPolicies);
    const plan = discoverWorkdayCountryPlan(first.facets, options?.filters?.country, controller.session.appliedFacets, policy);
    if (!plan) return run(controller, first);
    const scoped = this.withQueryScope(controller, plan);
    if (canonicalWorkdayScope(scoped.session) === canonicalWorkdayScope(controller.session)) {
      const result = await run(controller, first);
      if (!(result instanceof WorkdayListError)) result.country = plan.country;
      return result;
    }
    const cacheKey = `workday-country-validation:${canonicalWorkdayScope(controller.session)}:${plan.country.toLowerCase()}`;
    const validationSchema = z.object({ fingerprint: z.string(), valid: z.boolean() });
    let cachedValue: unknown;
    try { cachedValue = this.state?.get(cacheKey); }
    catch (error) { console.warn("Could not read Workday country filter validation:", error); }
    const cached = validationSchema.safeParse(cachedValue);
    const validated = cached.success && cached.data.fingerprint === plan.fingerprint ? cached.data.valid : undefined;
    if (validated === false) return run(controller, first);
    let baseline: WorkdayListFetchResult | undefined;
    // Inferred location sets must first preserve every country-matching listing
    // from a complete unfiltered snapshot. Changed facets invalidate that proof.
    if (plan.kind === "locations" && validated !== true) {
      const result = await run(controller, first);
      if (result instanceof WorkdayListError || !result.isComplete || result.jobs.length < result.advertisedCount) return result;
      baseline = result;
    }
    const filtered = await run(scoped);
    if (filtered instanceof WorkdayListError) {
      if (filtered.status === 400) {
        this.saveCountryValidation(cacheKey, plan, false, policy.validationTtlMs);
        return baseline ?? run(controller, first);
      }
      return filtered;
    }
    const expected = (baseline?.jobs ?? first.jobPostings)
      .filter((job) => matchesPreferredCountry(job.locationsText, plan.country));
    const actual = new Set(filtered.jobs.map((job) => this.getJobPostingId(job)));
    const preservesKnown = expected.every((job) => actual.has(this.getJobPostingId(job)));
    const respectsCount = plan.expectedMaximum === null || filtered.advertisedCount <= plan.expectedMaximum;
    const filteredExact = filtered.isComplete && filtered.jobs.length >= filtered.advertisedCount;
    if (!preservesKnown || !respectsCount || (baseline && !filteredExact)) {
      if (filteredExact && (!preservesKnown || !respectsCount)) {
        this.saveCountryValidation(cacheKey, plan, false, policy.validationTtlMs);
      }
      console.warn("Workday country filter failed its coverage check; retaining the configured source query.");
      return baseline ?? run(controller, first);
    }
    if (filteredExact) this.saveCountryValidation(cacheKey, plan, true, policy.validationTtlMs);
    filtered.country = plan.country;
    return filtered;
  }

  private withQueryScope(controller: WorkdaySessionController, plan: WorkdayCountryPlan): WorkdaySessionController {
    return {
      get session() { return { ...controller.session, appliedFacets: plan.appliedFacets }; },
      requestOptions: controller.requestOptions,
      bootstrap: async () => ({ ...await controller.bootstrap(), appliedFacets: plan.appliedFacets }),
    };
  }

  private saveCountryValidation(key: string, plan: WorkdayCountryPlan, valid: boolean, ttlMs: number): void {
    try {
      this.state?.set(key, { fingerprint: plan.fingerprint, valid }, new Date(Date.now() + ttlMs));
    } catch (error) {
      console.warn("Could not cache Workday country filter validation:", error);
    }
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
    jobs: WorkdayJobListItem[],
    country?: string
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
        const additionalLocations = detail.jobPostingInfo.additionalLocations?.map((value) =>
          typeof value === "string" ? value : value.descriptor
        ) ?? [];
        const locations = [...new Set([
          detail.jobPostingInfo.location, ...additionalLocations,
        ].filter((value): value is string => Boolean(value)))];
        // A primary detail country must not exclude another advertised location.
        const countryHint = country ?? [
          job.locationsText, detail.jobPostingInfo.country?.descriptor, ...locations,
        ].filter(Boolean).join(" | ");

        return {
          externalId,
          title: job.title,
          url: jobUrl,
          location: job.locationsText || detail.jobPostingInfo.location || "",
          country: countryHint || undefined,
          locations: locations.length ? locations : undefined,
          locationType: this.parseRemoteType(job.remoteType),
          description,
          descriptionFormat,
          employmentType: parseEmploymentType(detail.jobPostingInfo.timeType),
          postedDate: this.parsePostedDate(detail.jobPostingInfo.startDate || job.postedOn),
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
    job: WorkdayJobListItem,
    country?: string
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
      country,
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
