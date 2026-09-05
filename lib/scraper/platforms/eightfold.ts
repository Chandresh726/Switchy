import { z } from "zod";

import { processDescription } from "@/lib/jobs/description-processor";
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
  parseExternalPayload,
  ScraperPayloadError,
  type BrowserScraperConfig,
  type ScrapeOptions,
  type ScraperError,
  type ScrapedJob,
  type ScraperResult,
} from "@/lib/scraper/types";
import {
  AbstractBrowserScraper,
  DEFAULT_BROWSER_CONFIG,
} from "../core";
import { selectListingsForHydration } from "./shared/listing-selection";
import {
  isDetailFailuresTolerable,
  resolveListingCompleteness,
} from "./shared/completeness";

interface EightfoldSearchResponse {
  status: number;
  data?: {
    positions: EightfoldPosition[];
    count: number;
  };
}

interface EightfoldPosition {
  id: number;
  name: string;
  locations: string[];
  department?: string;
  workLocationOption?: string;
  postedTs?: number;
  positionUrl?: string;
}

interface EightfoldPositionDetails {
  status: number;
  data?: {
    id: number;
    name: string;
    locations: string[];
    jobDescription: string;
    publicUrl: string;
    department?: string;
    workLocationOption?: string;
    efcustomTextTimeType?: string[];
  };
}

const EightfoldPositionSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    locations: z.array(z.string()),
    department: z.string().optional(),
    workLocationOption: z.string().optional(),
    postedTs: z.number().optional(),
    positionUrl: z.string().optional(),
  })
  .passthrough();

const EightfoldSearchResponseSchema = z
  .object({
    status: z.number(),
    data: z
      .object({
        positions: z.array(EightfoldPositionSchema),
        count: z.number(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const EightfoldPositionDetailsSchema = z
  .object({
    status: z.number(),
    data: z
      .object({
        id: z.number(),
        name: z.string(),
        locations: z.array(z.string()),
        jobDescription: z.string(),
        publicUrl: z.string(),
        department: z.string().optional(),
        workLocationOption: z.string().optional(),
        efcustomTextTimeType: z.array(z.string()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

interface EightfoldNormalizedPosition {
  id: number;
  name: string;
  locations: string[];
  department?: string;
  positionUrl?: string;
  postedTs?: number;
  workLocationOption?: string;
  descriptionHtml?: string;
  employmentType?: string;
}

interface EightfoldListFetchResult {
  positions: EightfoldNormalizedPosition[];
  isComplete: boolean;
  advertisedCount: number;
  missingOffsets: number[];
  sitemapRecoveryFailureStatuses: Array<number | null>;
}

interface EightfoldDetailFetchResult {
  position: EightfoldNormalizedPosition | null;
  status: number | null;
}

interface EightfoldSessionCookieController {
  readonly cookies: string;
  refresh(staleCookies?: string, suppressErrors?: boolean): Promise<boolean>;
}

export type EightfoldConfig = BrowserScraperConfig & {
  parallelListFetches: number;
  detailBatchSize: number;
  detailRecoveryAttempts: number;
  requestDelayMs: number;
};

const EIGHTFOLD_PAGE_SIZE = 10;
const EIGHTFOLD_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DEFAULT_EIGHTFOLD_CONFIG: EightfoldConfig = {
  ...DEFAULT_BROWSER_CONFIG,
  parallelListFetches: 6,
  detailBatchSize: 4,
  detailRecoveryAttempts: 2,
  requestDelayMs: 400,
};

export class EightfoldScraper extends AbstractBrowserScraper<EightfoldConfig> {
  readonly platform = "eightfold" as const;
  override readonly capabilities = {
    transport: "browser",
    concurrency: "browser_limited",
    supportsCancellation: true,
  } as const;

  constructor(
    httpClient: IHttpClient,
    browserClient: IBrowserClient,
    config: Partial<EightfoldConfig> = {}
  ) {
    super(httpClient, browserClient, { ...DEFAULT_EIGHTFOLD_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return urlLower.includes("eightfold.ai");
  }

  extractIdentifier(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      if (hostname.includes("eightfold.ai")) {
        const subdomain = hostname.split(".")[0];
        return `${subdomain}.com`;
      }

      return hostname.replace(/^apply\./, "").replace(/^careers\./, "");
    } catch {
      return null;
    }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const parsedUrl = this.parseUrl(url);
      if (!parsedUrl) {
        return this.failure("invalid_url", "Could not parse Eightfold URL.");
      }

      const configuredDomain = this.normalizeDomain(options?.boardToken);
      const sourceDomain = this.normalizeDomain(parsedUrl.sourceUrl.searchParams.get("domain"));
      const resolvedDomain = configuredDomain ?? sourceDomain ?? parsedUrl.domain;
      if (!resolvedDomain) {
        return this.failure("board_not_found", "Could not detect Eightfold domain.");
      }

      const baseUrl = parsedUrl.baseUrl;
      const boardToken = resolvedDomain.replace(/\.com$/i, "");
      const sessionCookies = this.createSessionCookieController(
        "",
        async () => {
          try {
            const browserSession = await this.bootstrapSession(url);
            if (!browserSession?.cookies) {
              throw new BrowserSessionBootstrapError("session_extraction");
            }
            return browserSession.cookies;
          } catch (error) {
            throwIfScrapeAborted(error);
            if (error instanceof BrowserSessionBootstrapError) throw error;
            return null;
          }
        }
      );
      const listResult = await this.fetchAllPositions(
        parsedUrl.sourceUrl,
        resolvedDomain,
        sessionCookies
      );

      if (!listResult) {
        return this.failure("network_error", "Failed to fetch Eightfold jobs list.");
      }

      const allPositions = listResult.positions;
      const openExternalIds = allPositions.map((position) =>
        this.generateExternalId(this.platform, boardToken, position.id)
      );

      if (allPositions.length === 0) {
        if (!listResult.isComplete) {
          return this.failure(
            "parse_error",
            "Incomplete Eightfold list fetch with no usable job data."
          );
        }
        return {
          outcome: "success",
          jobs: [],
          totalListings: 0,
          detectedBoardToken: options?.boardToken ? undefined : resolvedDomain,
          openExternalIds,
          listingCompleteness: "complete",
        };
      }

      const selection = selectListingsForHydration({
        listings: allPositions,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (position) => ({
          title: position.name,
          location: position.locations?.join(", ") || "",
        }),
        getExternalId: (position) =>
          this.generateExternalId(this.platform, boardToken, position.id),
      });
      const positionsToFetch = selection.listings;

      if (positionsToFetch.length === 0) {
        const issues = listResult.isComplete
          ? undefined
          : [this.createListingIssue(listResult, allPositions.length)];
        return {
          outcome: listResult.isComplete ? "success" : "partial",
          jobs: [],
          totalListings: allPositions.length,
          detectedBoardToken: options?.boardToken ? undefined : resolvedDomain,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingCompleteness: listResult.isComplete ? "complete" : "partial",
          issues,
        };
      }

      const scrapedJobs: ScrapedJob[] = [];
      let detailFailures = 0;
      const detailFailureStatuses: Array<number | null> = [];
      let index = 0;
      let adaptiveDetailBatchSize = this.config.detailBatchSize;
      let adaptiveDelayMs = this.config.requestDelayMs;

      while (index < positionsToFetch.length) {
        const batchSize = Math.max(1, Math.min(adaptiveDetailBatchSize, positionsToFetch.length - index));
        const batch = positionsToFetch.slice(index, index + batchSize);

        const batchResults = await Promise.all(
          batch.map(async (position) => {
            if (position.descriptionHtml) {
              return {
                hasDetails: true,
                isRateLimited: false,
                job: this.mapPositionToScrapedJob(baseUrl, boardToken, position, position),
              };
            }

            const detailResult = await this.fetchPositionDetailsWithRecovery(
              baseUrl,
              resolvedDomain,
              position.id,
              sessionCookies
            );

            const isRateLimited = detailResult.status === 403 || detailResult.status === 429;
            const detailPosition = detailResult.position;

            if (!detailPosition) {
              detailFailures++;
              detailFailureStatuses.push(detailResult.status);
            }

            return {
              hasDetails: Boolean(detailPosition),
              isRateLimited,
              job: this.mapPositionToScrapedJob(baseUrl, boardToken, position, detailPosition || position),
            };
          })
        );

        scrapedJobs.push(...batchResults.map((result) => result.job));

        const rateLimitedResponses = batchResults.filter((result) => result.isRateLimited).length;
        const batchFailureCount = batchResults.filter((result) => !result.hasDetails).length;

        if (rateLimitedResponses > 0) {
          adaptiveDetailBatchSize = Math.max(1, adaptiveDetailBatchSize - 1);
          adaptiveDelayMs = Math.min(5000, adaptiveDelayMs + 400);
        } else if (batchFailureCount === 0) {
          adaptiveDetailBatchSize = Math.min(this.config.detailBatchSize, adaptiveDetailBatchSize + 1);
          adaptiveDelayMs = Math.max(this.config.requestDelayMs, adaptiveDelayMs - 100);
        }

        index += batch.length;
        if (index < positionsToFetch.length) {
          await this.delay(adaptiveDelayMs);
        }
      }

      const isPartial =
        !listResult.isComplete ||
        !isDetailFailuresTolerable(detailFailures, positionsToFetch.length);
      const issues: ScraperError[] = [];
      if (!listResult.isComplete) {
        issues.push(this.createListingIssue(listResult, allPositions.length));
      }
      if (detailFailures > 0) {
        const failureSummary = this.formatDetailFailureStatuses(
          detailFailureStatuses
        );
        issues.push(
          createScraperError(
            "network_error",
            `${detailFailures} Eightfold job detail request${detailFailures === 1 ? "" : "s"} failed${failureSummary ? ` (${failureSummary})` : ""}.`
          )
        );
      }

      return {
        outcome: isPartial ? "partial" : "success",
        jobs: scrapedJobs,
        totalListings: allPositions.length,
        advertisedTotal: listResult.advertisedCount,
        detectedBoardToken: options?.boardToken ? undefined : resolvedDomain,
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

  private parseUrl(url: string): {
    domain: string;
    subdomain: string | null;
    baseUrl: string;
    sourceUrl: URL;
  } | null {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      if (hostname.includes("eightfold.ai")) {
        const subdomain = hostname.split(".")[0];
        return {
          domain: `${subdomain}.com`,
          subdomain,
          baseUrl: `${urlObj.protocol}//${hostname}`,
          sourceUrl: urlObj,
        };
      }

      return {
        domain: hostname.replace(/^apply\./, "").replace(/^careers\./, ""),
        subdomain: null,
        baseUrl: `${urlObj.protocol}//${hostname}`,
        sourceUrl: urlObj,
      };
    } catch {
      return null;
    }
  }

  private normalizeDomain(value: string | null | undefined): string | null {
    if (!value) return null;
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized)) return null;
    return normalized;
  }

  private canUseSitemapRecovery(sourceUrl: URL): boolean {
    const nonScopeParameters = new Set(["domain", "pid", "start", "sort_by", "hl"]);
    for (const [key, value] of sourceUrl.searchParams) {
      const normalizedKey = key.toLowerCase();
      if (nonScopeParameters.has(normalizedKey)) continue;
      if ((normalizedKey === "query" || normalizedKey === "location") && !value) {
        continue;
      }
      return false;
    }
    return true;
  }

  private async fetchJobList(
    sourceUrl: URL,
    domain: string,
    sessionCookies: EightfoldSessionCookieController,
    start: number
  ): Promise<EightfoldSearchResponse | null> {
    const url = this.buildSearchUrl(sourceUrl, domain, start);

    try {
      const response = await this.fetchResponseWithCookieFallback(
        url,
        "application/json",
        sessionCookies
      );

      if (!response.ok) {
        throw new HttpError(
          response.status,
          `Failed to fetch Eightfold jobs: HTTP ${response.status}`,
          url
        );
      }
      return parseExternalPayload(
        EightfoldSearchResponseSchema,
        await response.json(),
        "Eightfold search"
      );
    } catch (error) {
      if (error instanceof HttpError || error instanceof ScraperPayloadError) throw error;
      throwIfScrapeAborted(error);
      return null;
    }
  }

  private async fetchAllPositions(
    sourceUrl: URL,
    domain: string,
    sessionCookies: EightfoldSessionCookieController
  ): Promise<EightfoldListFetchResult | null> {
    const baseUrl = `${sourceUrl.protocol}//${sourceUrl.hostname}`;
    const fetchSafely = async (offset: number) => {
      try {
        return await this.fetchJobList(
          sourceUrl,
          domain,
          sessionCookies,
          offset
        );
      } catch (error) {
        if (error instanceof ScraperPayloadError) throw error;
        if (error instanceof BrowserSessionBootstrapError) throw error;
        throwIfScrapeAborted(error);
        return null;
      }
    };

    const firstBatch = await fetchSafely(0);

    if (!firstBatch || firstBatch.status !== 200 || !firstBatch.data) {
      return null;
    }

    let advertisedCount = firstBatch.data.count || 0;
    const positionsById = new Map<number, EightfoldNormalizedPosition>();
    for (const position of firstBatch.data.positions) {
      const normalized = this.normalizePosition(position);
      positionsById.set(normalized.id, normalized);
    }
    const missingOffsets = new Set<number>();
    if (
      firstBatch.data.positions.length <
      Math.min(EIGHTFOLD_PAGE_SIZE, advertisedCount)
    ) {
      missingOffsets.add(0);
    }

    if (advertisedCount > EIGHTFOLD_PAGE_SIZE) {
      const totalPages = Math.ceil(advertisedCount / EIGHTFOLD_PAGE_SIZE);
      const offsets: number[] = [];

      for (let page = 1; page < totalPages; page++) {
        offsets.push(page * EIGHTFOLD_PAGE_SIZE);
      }

      const fetchPage = async (
        offset: number
      ): Promise<EightfoldSearchResponse | null> => {
        try {
          return await this.fetchJobList(
            sourceUrl,
            domain,
            sessionCookies,
            offset
          );
        } catch (error) {
          if (error instanceof BrowserSessionBootstrapError) throw error;
          throwIfScrapeAborted(error);
          return null;
        }
      };

      for (let i = 0; i < offsets.length; i += this.config.parallelListFetches) {
        const batchOffsets = offsets.slice(i, i + this.config.parallelListFetches);
        const results = await Promise.all(
          batchOffsets.map((offset) => fetchPage(offset))
        );

        for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
          const result = results[resultIndex];
          const offset = batchOffsets[resultIndex];
          if (offset === undefined) continue;
          if (!result || !result.data || !Array.isArray(result.data.positions)) {
            missingOffsets.add(offset);
          } else {
            for (const position of result.data.positions) {
              const normalized = this.normalizePosition(position);
              positionsById.set(normalized.id, normalized);
            }
            const expectedCount = Math.min(
              EIGHTFOLD_PAGE_SIZE,
              advertisedCount - offset
            );
            if (result.data.positions.length < expectedCount) {
              missingOffsets.add(offset);
            }
          }
        }
      }
    }

    if (missingOffsets.size > 0) {
      for (const offset of Array.from(missingOffsets).sort((a, b) => a - b)) {
        const result = await fetchSafely(offset);
        if (!result?.data || !Array.isArray(result.data.positions)) continue;

        for (const position of result.data.positions) {
          const normalized = this.normalizePosition(position);
          positionsById.set(normalized.id, normalized);
        }
        const expectedCount = Math.min(
          EIGHTFOLD_PAGE_SIZE,
          advertisedCount - offset
        );
        if (result.data.positions.length >= expectedCount) {
          missingOffsets.delete(offset);
        }
      }
    }

    const sitemapRecoveryFailureStatuses: Array<number | null> = [];
    let sitemapReconciled = false;
    if (
      this.canUseSitemapRecovery(sourceUrl) &&
      (missingOffsets.size > 0 || positionsById.size < advertisedCount)
    ) {
      const sitemapPositionIds = await this.fetchSitemapPositionIds(
        baseUrl,
        domain,
        sessionCookies
      );
      if (sitemapPositionIds && sitemapPositionIds.size > 0) {
        advertisedCount = Math.max(advertisedCount, sitemapPositionIds.size);
        const missingPositionIds = Array.from(sitemapPositionIds).filter(
          (positionId) => !positionsById.has(positionId)
        );
        let sitemapHydrationFailed = false;
        const staleSitemapPositionIds = new Set<number>();

        for (
          let index = 0;
          index < missingPositionIds.length;
          index += this.config.detailBatchSize
        ) {
          const batch = missingPositionIds.slice(
            index,
            index + this.config.detailBatchSize
          );
          const details = await Promise.all(
            batch.map((positionId) =>
              this.fetchPositionDetailsWithRecovery(
                baseUrl,
                domain,
                positionId,
                sessionCookies
              )
            )
          );
          for (let detailIndex = 0; detailIndex < details.length; detailIndex++) {
            const detailResult = details[detailIndex];
            const detail = detailResult?.position;
            if (!detail) {
              const positionId = batch[detailIndex];
              if (detailResult?.status === 404 && positionId !== undefined) {
                staleSitemapPositionIds.add(positionId);
                continue;
              }
              sitemapHydrationFailed = true;
              sitemapRecoveryFailureStatuses.push(detailResult?.status ?? null);
              continue;
            }
            positionsById.set(detail.id, detail);
          }
        }

        const activeSitemapPositionIds = Array.from(sitemapPositionIds).filter(
          (positionId) => !staleSitemapPositionIds.has(positionId)
        );
        if (
          !sitemapHydrationFailed &&
          activeSitemapPositionIds.every((positionId) =>
            positionsById.has(positionId)
          )
        ) {
          missingOffsets.clear();
          sitemapReconciled = true;
        }
      }
    }

    const allPositions = Array.from(positionsById.values());
    // Over-fetching (or a reconciled sitemap) clears missing offsets: the
    // pages demonstrably delivered. Tolerance-based completeness below must
    // NOT clear them — a failed page with a small gap stays a hard failure
    // like on Oracle/Workday.
    const genuinelyComplete = allPositions.length >= advertisedCount;
    if (genuinelyComplete || sitemapReconciled) {
      missingOffsets.clear();
    }
    // Advertised counts drift by a few positions; exact equality turned
    // small gaps into board failures.
    const { isComplete: countsComplete } = resolveListingCompleteness(
      allPositions.length,
      advertisedCount
    );
    const countIsComplete =
      countsComplete || sitemapReconciled;

    return {
      positions: allPositions,
      isComplete: missingOffsets.size === 0 && countIsComplete,
      advertisedCount,
      missingOffsets: Array.from(missingOffsets).sort((a, b) => a - b),
      sitemapRecoveryFailureStatuses,
    };
  }

  private createSessionCookieController(
    initialCookies: string,
    refreshCookies: () => Promise<string | null>
  ): EightfoldSessionCookieController {
    let activeCookies = initialCookies;
    let refreshAttempts = 0;
    let refreshInFlight: Promise<boolean> | null = null;
    const maxRefreshAttempts = 1;

    return {
      get cookies() {
        return activeCookies;
      },
      refresh: async (staleCookies?: string, suppressErrors = false) => {
        if (staleCookies !== undefined && staleCookies !== activeCookies) {
          return true;
        }
        if (refreshInFlight) return refreshInFlight;
        if (refreshAttempts >= maxRefreshAttempts) return false;

        refreshAttempts++;
        const refresh = refreshCookies().then((cookies) => {
          if (!cookies) return false;
          activeCookies = cookies;
          return true;
        });
        refreshInFlight = refresh;
        try {
          return await refresh;
        } catch (error) {
          if (suppressErrors) return false;
          throw error;
        } finally {
          if (refreshInFlight === refresh) refreshInFlight = null;
        }
      },
    };
  }

  private async fetchPositionDetailsWithRecovery(
    baseUrl: string,
    domain: string,
    positionId: number,
    sessionCookies: EightfoldSessionCookieController
  ): Promise<EightfoldDetailFetchResult> {
    let lastResult: EightfoldDetailFetchResult = {
      position: null,
      status: null,
    };

    for (
      let attempt = 0;
      attempt <= this.config.detailRecoveryAttempts;
      attempt++
    ) {
      lastResult = await this.fetchPositionDetails(
        baseUrl,
        domain,
        positionId,
        sessionCookies
      );
      if (lastResult.position) return lastResult;
      if (
        attempt >= this.config.detailRecoveryAttempts ||
        !this.shouldRetryDetailStatus(lastResult.status)
      ) {
        return lastResult;
      }

      await this.delay(
        Math.min(
          5000,
          Math.max(250, this.config.requestDelayMs) * 2 ** attempt
        )
      );
    }

    return lastResult;
  }

  private shouldRetryDetailStatus(status: number | null): boolean {
    return (
      status === null ||
      status === 403 ||
      status === 408 ||
      status === 425 ||
      status === 429 ||
      status >= 500
    );
  }

  private formatDetailFailureStatuses(
    statuses: Array<number | null>
  ): string | null {
    if (statuses.length === 0) return null;
    const counts = new Map<string, number>();
    for (const status of statuses) {
      const label = status === null ? "network or parse" : `HTTP ${status}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => `${label}: ${count}`)
      .join(", ");
  }

  private createListingIssue(
    result: EightfoldListFetchResult,
    fetchedCount: number
  ): ScraperError {
    const recoveryFailureSummary = this.formatDetailFailureStatuses(
      result.sitemapRecoveryFailureStatuses
    );
    return createScraperError(
      "network_error",
      `Eightfold listings were only partially fetched (${fetchedCount} of ${result.advertisedCount} advertised positions; ${result.missingOffsets.length} page offset${result.missingOffsets.length === 1 ? "" : "s"} unresolved${recoveryFailureSummary ? `; sitemap recovery failures: ${recoveryFailureSummary}` : ""}).`
    );
  }

  private async fetchSitemapPositionIds(
    baseUrl: string,
    domain: string,
    sessionCookies: EightfoldSessionCookieController
  ): Promise<Set<number> | null> {
    const url = `${baseUrl}/careers/sitemap.xml?domain=${encodeURIComponent(domain)}`;
    try {
      const response = await this.fetchResponseWithCookieFallback(
        url,
        "application/xml",
        sessionCookies
      );
      if (!response.ok) return null;

      const sitemap = await response.text();
      const positionIds = new Set<number>();
      for (const match of sitemap.matchAll(/\/careers\/job\/(\d+)/g)) {
        const positionId = Number(match[1]);
        if (Number.isSafeInteger(positionId) && positionId > 0) {
          positionIds.add(positionId);
        }
      }
      return positionIds;
    } catch (error) {
      if (error instanceof BrowserSessionBootstrapError) throw error;
      throwIfScrapeAborted(error);
      return null;
    }
  }

  private async fetchPositionDetails(
    baseUrl: string,
    domain: string,
    positionId: number,
    sessionCookies: EightfoldSessionCookieController
  ): Promise<EightfoldDetailFetchResult> {
    const url = `${baseUrl}/api/pcsx/position_details?position_id=${positionId}&domain=${encodeURIComponent(domain)}&hl=en`;

    try {
      const response = await this.fetchResponseWithCookieFallback(
        url,
        "application/json",
        sessionCookies
      );

      if (!response.ok) {
        return { position: null, status: response.status };
      }

      const details: EightfoldPositionDetails = parseExternalPayload(
        EightfoldPositionDetailsSchema,
        await response.json(),
        "Eightfold detail"
      );
      if (!details.data) {
        return { position: null, status: response.status };
      }

      return {
        position: {
          id: details.data.id,
          name: details.data.name,
          locations: details.data.locations || [],
          department: details.data.department,
          positionUrl: details.data.publicUrl,
          workLocationOption: details.data.workLocationOption,
          descriptionHtml: details.data.jobDescription,
          employmentType: details.data.efcustomTextTimeType?.[0],
        },
        status: response.status,
      };
    } catch (error) {
      throwIfScrapeAborted(error);
      return { position: null, status: null };
    }
  }

  private buildSearchUrl(sourceUrl: URL, domain: string, start: number): string {
    const url = new URL("/api/pcsx/search", sourceUrl.origin);
    for (const [key, value] of sourceUrl.searchParams) {
      if (key.toLowerCase() === "pid") continue;
      url.searchParams.append(key, value);
    }
    url.searchParams.set("domain", domain);
    url.searchParams.set("start", String(start));
    if (!url.searchParams.has("query")) url.searchParams.set("query", "");
    if (!url.searchParams.has("location")) url.searchParams.set("location", "");
    if (!url.searchParams.has("sort_by")) {
      url.searchParams.set("sort_by", "timestamp");
    }
    return url.toString();
  }

  private async fetchResponseWithCookieFallback(
    url: string,
    accept: "application/json" | "application/xml" | "text/html",
    sessionCookies: EightfoldSessionCookieController
  ): Promise<Response> {
    const request = (cookies: string) =>
      this.httpClient.fetch(url, {
        headers: this.createRequestHeaders(accept, cookies),
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
      });

    const cookiesUsed = sessionCookies.cookies;
    let response = await request(cookiesUsed);
    for (
      let retry = 0;
      response.status === 403 && !cookiesUsed && retry < this.config.retries;
      retry++
    ) {
      await this.delay(
        Math.min(5_000, Math.max(250, this.config.baseDelay) * 2 ** retry)
      );
      response = await request(cookiesUsed);
    }
    if (
      (response.status === 401 || response.status === 403) &&
      (await sessionCookies.refresh(cookiesUsed))
    ) {
      response = await request(sessionCookies.cookies);
    }
    return response;
  }

  private normalizePosition(position: EightfoldPosition): EightfoldNormalizedPosition {
    return {
      id: position.id,
      name: position.name,
      locations: position.locations || [],
      department: position.department,
      positionUrl: position.positionUrl,
      postedTs: position.postedTs,
      workLocationOption: position.workLocationOption,
    };
  }

  private createRequestHeaders(
    accept: "application/json" | "application/xml" | "text/html",
    cookies: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": EIGHTFOLD_USER_AGENT,
    };

    if (cookies.trim().length > 0) {
      headers.Cookie = cookies;
    }

    return headers;
  }

  private mapPositionToScrapedJob(
    baseUrl: string,
    boardToken: string,
    listPosition: EightfoldNormalizedPosition,
    details: EightfoldNormalizedPosition
  ): ScrapedJob {
    const location = details.locations?.join(", ") || listPosition.locations?.join(", ") || "";
    const { description, descriptionFormat } = this.processDescription(
      details.descriptionHtml || listPosition.descriptionHtml || ""
    );

    return {
      externalId: this.generateExternalId(this.platform, boardToken, listPosition.id),
      title: details.name || listPosition.name,
      url: this.buildJobUrl(baseUrl, details.positionUrl || listPosition.positionUrl, listPosition.id),
      location,
      locationType: this.parseWorkLocation(details.workLocationOption || listPosition.workLocationOption),
      department: details.department || listPosition.department,
      description,
      descriptionFormat,
      employmentType: parseEmploymentType(details.employmentType || listPosition.employmentType),
      postedDate: this.parsePostedDate(details.postedTs || listPosition.postedTs),
    };
  }

  private processDescription(
    description: string
  ): { description: string | undefined; descriptionFormat: "markdown" | "plain" } {
    if (!description) {
      return { description: undefined, descriptionFormat: "plain" };
    }

    const result = processDescription(description, "html");
    return {
      description: result.text ?? undefined,
      descriptionFormat: result.format,
    };
  }

  private buildJobUrl(baseUrl: string, maybeUrl: string | undefined, positionId: number): string {
    if (maybeUrl) {
      if (maybeUrl.startsWith("http")) {
        return maybeUrl;
      }
      return `${baseUrl}${maybeUrl}`;
    }
    return `${baseUrl}/careers/job/${positionId}`;
  }

  private parseWorkLocation(option?: string): "remote" | "hybrid" | "onsite" | undefined {
    if (!option) return undefined;
    const lower = option.toLowerCase();
    if (lower === "remote_local" || lower === "remote" || lower.includes("remote")) return "remote";
    if (lower === "hybrid") return "hybrid";
    if (lower === "onsite" || lower.includes("site")) return "onsite";
    return undefined;
  }

  private parsePostedDate(postedTs: number | undefined): Date | undefined {
    if (!postedTs) return undefined;
    const ms = postedTs > 1_000_000_000_000 ? postedTs : postedTs * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
}
