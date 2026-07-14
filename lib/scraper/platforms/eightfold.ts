import { z } from "zod";

import { processDescription } from "@/lib/jobs/description-processor";
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
import {
  AbstractBrowserScraper,
  DEFAULT_BROWSER_CONFIG,
  SWITCHY_USER_AGENT,
} from "../core";
import { selectListingsForHydration } from "./shared/listing-selection";

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
  workLocationOption?: "onsite" | "hybrid" | "remote_local";
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
    workLocationOption?: "onsite" | "hybrid" | "remote_local";
    efcustomTextTimeType?: string[];
  };
}

const EightfoldPositionSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    locations: z.array(z.string()),
    department: z.string().optional(),
    workLocationOption: z.enum(["onsite", "hybrid", "remote_local"]).optional(),
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
        workLocationOption: z.enum(["onsite", "hybrid", "remote_local"]).optional(),
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
  sessionCookies: string;
}

interface EightfoldDetailFetchResult {
  position: EightfoldNormalizedPosition | null;
  status: number | null;
}

export type EightfoldConfig = BrowserScraperConfig & {
  pageSize: number;
  parallelListFetches: number;
  detailBatchSize: number;
  requestDelayMs: number;
};

export const DEFAULT_EIGHTFOLD_CONFIG: EightfoldConfig = {
  ...DEFAULT_BROWSER_CONFIG,
  pageSize: 10,
  parallelListFetches: 2,
  detailBatchSize: 4,
  requestDelayMs: 400,
};

export class EightfoldScraper extends AbstractBrowserScraper<EightfoldConfig> {
  readonly platform = "eightfold" as const;
  override readonly capabilities = {
    transport: "browser",
    concurrency: "serial",
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

      const isDirectEightfold = url.toLowerCase().includes("eightfold.ai");
      const session = await this.bootstrapSession(url);

      if (!session) {
        return this.failure("browser_error", "Failed to establish Eightfold browser session.");
      }

      let domain: string | undefined = options?.boardToken ?? session.domain;
      const baseUrl = session.baseUrl || parsedUrl.baseUrl;
      let detectedBoardToken: string | undefined;

      if (session.domain && !options?.boardToken) {
        detectedBoardToken = session.domain;
        console.log(`[Scraper] Unknown - Bootstrapped browser session (domain: ${session.domain})`);
      }

      if (!domain && isDirectEightfold) {
        const apiDetectedDomain = await this.detectDomainFromApi(baseUrl, session.cookies);
        domain = apiDetectedDomain || (parsedUrl.subdomain ? `${parsedUrl.subdomain}.com` : parsedUrl.domain);
      }

      if (!domain) {
        domain = parsedUrl.domain;
      }

      if (!domain) {
        return this.failure("board_not_found", "Could not detect Eightfold domain.");
      }

      const resolvedDomain = domain;
      const boardToken = domain.replace(/\.com$/i, "");
      const listResult = await this.fetchAllPositions(
        baseUrl,
        resolvedDomain,
        session.cookies,
        async () => {
          try {
            return (await this.bootstrapSession(url))?.cookies ?? null;
          } catch (error) {
            throwIfScrapeAborted(error);
            return null;
          }
        }
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
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : resolvedDomain),
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
          : [
              createScraperError(
                "network_error",
                `Eightfold listings were only partially fetched (${allPositions.length} of ${listResult.advertisedCount} advertised positions; ${listResult.missingOffsets.length} page offset${listResult.missingOffsets.length === 1 ? "" : "s"} unresolved).`
              ),
            ];
        return {
          outcome: listResult.isComplete ? "success" : "partial",
          jobs: [],
          totalListings: allPositions.length,
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : resolvedDomain),
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingCompleteness: listResult.isComplete ? "complete" : "partial",
          issues,
        };
      }

      const scrapedJobs: ScrapedJob[] = [];
      let detailFailures = 0;
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

            const detailResult = await this.fetchPositionDetails(
              baseUrl,
              resolvedDomain,
              position.id,
              listResult.sessionCookies
            );

            const isRateLimited = detailResult.status === 403 || detailResult.status === 429;
            const detailPosition = detailResult.position;

            if (!detailPosition) {
              detailFailures++;
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

      const isPartial = detailFailures > 0 || !listResult.isComplete;
      const issues: ScraperError[] = [];
      if (!listResult.isComplete) {
        issues.push(
          createScraperError(
            "network_error",
            `Eightfold listings were only partially fetched (${allPositions.length} of ${listResult.advertisedCount} advertised positions; ${listResult.missingOffsets.length} page offset${listResult.missingOffsets.length === 1 ? "" : "s"} unresolved).`
          )
        );
      }
      if (detailFailures > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${detailFailures} Eightfold job detail request${detailFailures === 1 ? "" : "s"} failed.`
          )
        );
      }

      return {
        outcome: isPartial ? "partial" : "success",
        jobs: scrapedJobs,
        totalListings: allPositions.length,
        detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : resolvedDomain),
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

  private parseUrl(url: string): { domain: string; subdomain: string | null; baseUrl: string } | null {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      if (hostname.includes("eightfold.ai")) {
        const subdomain = hostname.split(".")[0];
        return {
          domain: `${subdomain}.com`,
          subdomain,
          baseUrl: `${urlObj.protocol}//${hostname}`,
        };
      }

      return {
        domain: hostname.replace(/^apply\./, "").replace(/^careers\./, ""),
        subdomain: null,
        baseUrl: `${urlObj.protocol}//${hostname}`,
      };
    } catch {
      return null;
    }
  }

  private async detectDomainFromApi(baseUrl: string, cookies: string): Promise<string | null> {
    try {
      const response = await this.httpClient.fetch(`${baseUrl}/api/pcsx/job_cart`, {
        headers: this.createRequestHeaders("application/json", cookies),
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
      });

      if (response.ok) {
        const text = await response.text();
        const domainMatch = text.match(/"domain"\s*:\s*"([^"]+)"/);
        if (domainMatch) {
          return domainMatch[1];
        }
      }

      const pageResponse = await this.httpClient.fetch(baseUrl, {
        headers: this.createRequestHeaders("text/html", cookies),
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
      });

      if (pageResponse.ok) {
        const html = await pageResponse.text();
        const domainMatch = html.match(/domain["\s:=]+(["']?)([^"'\s,)}]+)\1/i);
        if (domainMatch) {
          return domainMatch[2];
        }
      }

      return null;
    } catch (error) {
      throwIfScrapeAborted(error);
      return null;
    }
  }

  private async fetchJobList(
    baseUrl: string,
    domain: string,
    cookies: string,
    start: number
  ): Promise<EightfoldSearchResponse | null> {
    const url = `${baseUrl}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=${start}&sort_by=timestamp`;

    try {
      const response = await this.httpClient.fetch(url, {
        headers: this.createRequestHeaders("application/json", cookies),
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
      });

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
    baseUrl: string,
    domain: string,
    cookies: string,
    refreshCookies: () => Promise<string | null>
  ): Promise<EightfoldListFetchResult | null> {
    const fetchSafely = async (activeCookies: string, offset: number) => {
      try {
        return await this.fetchJobList(baseUrl, domain, activeCookies, offset);
      } catch (error) {
        if (error instanceof ScraperPayloadError) throw error;
        throwIfScrapeAborted(error);
        return null;
      }
    };

    let activeCookies = cookies;
    let sessionRefreshed = false;
    const refreshOnce = async () => {
      if (sessionRefreshed) return null;
      sessionRefreshed = true;
      return refreshCookies();
    };
    let firstBatch = await fetchSafely(activeCookies, 0);

    if (!firstBatch || firstBatch.status !== 200 || !firstBatch.data) {
      const refreshedCookies = await refreshOnce();
      if (!refreshedCookies) return null;
      activeCookies = refreshedCookies;
      firstBatch = await fetchSafely(activeCookies, 0);
    }

    if (!firstBatch || firstBatch.status !== 200 || !firstBatch.data) {
      return null;
    }

    const total = firstBatch.data.count || 0;
    const positionsById = new Map<number, EightfoldNormalizedPosition>();
    for (const position of firstBatch.data.positions) {
      const normalized = this.normalizePosition(position);
      positionsById.set(normalized.id, normalized);
    }
    const missingOffsets = new Set<number>();
    if (firstBatch.data.positions.length < Math.min(this.config.pageSize, total)) {
      missingOffsets.add(0);
    }

    if (total > this.config.pageSize) {
      const totalPages = Math.ceil(total / this.config.pageSize);
      const offsets: number[] = [];

      for (let page = 1; page < totalPages; page++) {
        offsets.push(page * this.config.pageSize);
      }

      const fetchWithStagger = async (
        offset: number,
        index: number
      ): Promise<EightfoldSearchResponse | null> => {
        await this.delay(index * 50);
        try {
          return await this.fetchJobList(baseUrl, domain, activeCookies, offset);
        } catch (error) {
          throwIfScrapeAborted(error);
          return null;
        }
      };

      for (let i = 0; i < offsets.length; i += this.config.parallelListFetches) {
        const batchOffsets = offsets.slice(i, i + this.config.parallelListFetches);
        const results = await Promise.all(
          batchOffsets.map((offset, idx) => fetchWithStagger(offset, idx))
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
            const expectedCount = Math.min(this.config.pageSize, total - offset);
            if (result.data.positions.length < expectedCount) {
              missingOffsets.add(offset);
            }
          }
        }

        if (i + this.config.parallelListFetches < offsets.length) {
          await this.delay(this.config.requestDelayMs);
        }
      }
    }

    if (missingOffsets.size > 0) {
      const retryCookies = sessionRefreshed ? activeCookies : await refreshOnce();
      if (retryCookies) {
        activeCookies = retryCookies;
        for (const offset of Array.from(missingOffsets).sort((a, b) => a - b)) {
          const result = await fetchSafely(activeCookies, offset);
          if (!result?.data || !Array.isArray(result.data.positions)) continue;

          for (const position of result.data.positions) {
            const normalized = this.normalizePosition(position);
            positionsById.set(normalized.id, normalized);
          }
          const expectedCount = Math.min(this.config.pageSize, total - offset);
          if (result.data.positions.length >= expectedCount) {
            missingOffsets.delete(offset);
          }
        }
      }
    }

    const allPositions = Array.from(positionsById.values());
    if (allPositions.length >= total) {
      missingOffsets.clear();
    }

    return {
      positions: allPositions,
      isComplete: missingOffsets.size === 0 && allPositions.length >= total,
      advertisedCount: total,
      missingOffsets: Array.from(missingOffsets).sort((a, b) => a - b),
      sessionCookies: activeCookies,
    };
  }

  private async fetchPositionDetails(
    baseUrl: string,
    domain: string,
    positionId: number,
    cookies: string
  ): Promise<EightfoldDetailFetchResult> {
    const url = `${baseUrl}/api/pcsx/position_details?position_id=${positionId}&domain=${encodeURIComponent(domain)}&hl=en`;

    try {
      const response = await this.httpClient.fetch(url, {
        headers: this.createRequestHeaders("application/json", cookies),
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
      });

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
    accept: "application/json" | "text/html",
    cookies: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": SWITCHY_USER_AGENT,
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
