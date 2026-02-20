import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import type { IBrowserClient, BrowserSession } from "@/lib/scraper/infrastructure/browser-client";
import type { ScraperResult, ScrapeOptions, ScrapedJob, BrowserScraperConfig, EarlyFilterStats, JobFilters } from "@/lib/scraper/types";
import { processDescription } from "@/lib/jobs/description-processor";
import { parseEmploymentType } from "@/lib/scraper/types";
import { applyEarlyFilters, hasEarlyFilters, toEarlyFilterStats } from "@/lib/scraper/services";
import { AbstractBrowserScraper, DEFAULT_BROWSER_CONFIG } from "../core";

interface EightfoldSearchResponse {
  status: number;
  error?: { message: string };
  data?: {
    positions: EightfoldPosition[];
    count: number;
  };
}

interface EightfoldPosition {
  id: number;
  displayJobId?: string;
  name: string;
  locations: string[];
  standardizedLocations?: string[];
  department?: string;
  workLocationOption?: "onsite" | "hybrid" | "remote_local";
  locationFlexibility?: string | null;
  postedTs: number;
  positionUrl: string;
  atsJobId?: string;
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
    displayJobId?: string;
  };
}

interface EightfoldListFetchResult {
  positions: EightfoldPosition[];
  isComplete: boolean;
}

interface EightfoldDetailFetchResult {
  details: EightfoldPositionDetails | null;
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
        return {
          success: false,
          outcome: "error",
          jobs: [],
          error: "Could not parse Eightfold URL.",
        };
      }

      const isDirectEightfold = url.toLowerCase().includes("eightfold.ai");
      const session = await this.bootstrapSession(url);

      if (!session) {
        return {
          success: false,
          outcome: "error",
          jobs: [],
          error: "Failed to establish Eightfold browser session.",
        };
      }

      let domain: string | undefined = options?.boardToken ?? session.domain;
      const baseUrl: string = session.baseUrl || parsedUrl.baseUrl;
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
        return {
          success: false,
          outcome: "error",
          jobs: [],
          error: "Could not detect Eightfold domain.",
        };
      }

      const filters: JobFilters | undefined = options?.filters;
      const existingExternalIds = options?.existingExternalIds;
      const resolvedDomain = domain;
      const boardToken = domain.replace(/\.com$/i, "");
      let adaptiveDetailBatchSize = this.config.detailBatchSize;
      let adaptiveDelayMs = this.config.requestDelayMs;

      const listResult = await this.fetchAllPositions(baseUrl, domain, session.cookies);
      if (!listResult) {
        return {
          success: false,
          outcome: "error",
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : resolvedDomain),
          openExternalIds: [],
          openExternalIdsComplete: false,
          error: "Failed to fetch Eightfold jobs list.",
        };
      }

      const allPositions = listResult.positions;
      const openExternalIds = allPositions.map((position) =>
        this.generateExternalId(this.platform, boardToken, position.id)
      );

      if (allPositions.length === 0) {
        const isError = !listResult.isComplete;
        return {
          success: !isError,
          outcome: isError ? "error" : "success",
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : resolvedDomain),
          openExternalIds,
          openExternalIdsComplete: listResult.isComplete,
          error: isError ? "Incomplete Eightfold list fetch with no usable job data." : undefined,
        };
      }

      let positionsToProcess = allPositions;
      let earlyFilterStats: EarlyFilterStats | undefined;

      if (hasEarlyFilters(filters)) {
        const filterablePositions = allPositions.map((pos) => ({
          ...pos,
          title: pos.name,
          location: pos.locations?.join(", ") || "",
        }));

        const earlyFilterResult = applyEarlyFilters(filterablePositions, filters);
        const { filtered } = earlyFilterResult;
        positionsToProcess = filtered as EightfoldPosition[];
        earlyFilterStats = toEarlyFilterStats(earlyFilterResult);
      }

      if (positionsToProcess.length === 0) {
        const baseOutcome = listResult.isComplete ? "success" : "partial";
        return {
          success: true,
          outcome: baseOutcome,
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : resolvedDomain),
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          openExternalIdsComplete: listResult.isComplete,
        };
      }

      let positionsToFetch = positionsToProcess;

      if (existingExternalIds && existingExternalIds.size > 0) {
        positionsToFetch = positionsToProcess.filter((pos) => {
          const externalId = this.generateExternalId(this.platform, boardToken, pos.id);
          return !existingExternalIds.has(externalId);
        });
      }

      if (positionsToFetch.length === 0) {
        const baseOutcome = listResult.isComplete ? "success" : "partial";
        return {
          success: true,
          outcome: baseOutcome,
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : resolvedDomain),
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          openExternalIdsComplete: listResult.isComplete,
        };
      }

      const scrapedJobs: ScrapedJob[] = [];
      let detailFailures = 0;
      let index = 0;

      while (index < positionsToFetch.length) {
        const batchSize = Math.max(
          1,
          Math.min(adaptiveDetailBatchSize, positionsToFetch.length - index)
        );
        const batch = positionsToFetch.slice(index, index + batchSize);

        const detailPromises = batch.map(async (position) => {
          const detailResult = await this.fetchPositionDetails(
            baseUrl,
            resolvedDomain,
            position.id,
            session.cookies
          );
          const isRateLimited = detailResult.status === 403 || detailResult.status === 429;
          const details = detailResult.details?.data;
          if (!details) {
            detailFailures++;
          }
          return {
            isRateLimited,
            hasDetails: Boolean(details),
            job: this.mapPositionToScrapedJob(baseUrl, boardToken, position, details),
          };
        });

        const results = await Promise.all(detailPromises);
        scrapedJobs.push(...results.map((result) => result.job));
        const rateLimitedResponses = results.filter((result) => result.isRateLimited).length;
        const batchFailureCount = results.filter((result) => !result.hasDetails).length;

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
      return {
        success: true,
        outcome: isPartial ? "partial" : "success",
        jobs: scrapedJobs,
        detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : resolvedDomain),
        earlyFiltered: earlyFilterStats,
        openExternalIds,
        openExternalIdsComplete: listResult.isComplete,
      };
    } catch (error) {
      return {
        success: false,
        outcome: "error",
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  protected async bootstrapSession(url: string): Promise<BrowserSession | null> {
    const parsedUrl = this.parseUrl(url);
    if (!parsedUrl) return null;

    return this.browserClient.bootstrap(url);
  }

  private parseUrl(url: string): { domain: string; subdomain: string | null; baseUrl: string } | null {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();

      if (hostname.includes("eightfold.ai")) {
        const subdomain = hostname.split(".")[0];
        const domain = `${subdomain}.com`;
        return {
          domain,
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
    } catch {
      return null;
    }
  }

  private async fetchJobList(
    baseUrl: string,
    domain: string,
    cookies: string,
    start: number = 0
  ): Promise<EightfoldSearchResponse | null> {
    const url = `${baseUrl}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=${start}&sort_by=timestamp`;

    try {
      const response = await this.httpClient.fetch(url, {
        headers: this.createRequestHeaders("application/json", cookies),
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
      });

      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  private async fetchAllPositions(
    baseUrl: string,
    domain: string,
    cookies: string
  ): Promise<EightfoldListFetchResult | null> {
    const firstBatch = await this.fetchJobList(baseUrl, domain, cookies, 0);

    if (!firstBatch || firstBatch.status !== 200 || !firstBatch.data) {
      return null;
    }

    const total = firstBatch.data.count || 0;
    const allPositions = [...firstBatch.data.positions];
    let failedPages = 0;

    if (total > this.config.pageSize) {
      const totalPages = Math.ceil(total / this.config.pageSize);
      const offsets: number[] = [];

      for (let page = 1; page < totalPages; page++) {
        offsets.push(page * this.config.pageSize);
      }

      const fetchWithStagger = async (offset: number, index: number): Promise<EightfoldSearchResponse | null> => {
        const staggerDelay = index * 50;
        await this.delay(staggerDelay);
        return this.fetchJobList(baseUrl, domain, cookies, offset);
      };

      for (let i = 0; i < offsets.length; i += this.config.parallelListFetches) {
        const batchOffsets = offsets.slice(i, i + this.config.parallelListFetches);
        const results = await Promise.all(
          batchOffsets.map((offset, idx) => fetchWithStagger(offset, idx))
        );

        for (const result of results) {
          if (!result || !result.data || !Array.isArray(result.data.positions)) {
            failedPages++;
          } else {
            allPositions.push(...result.data.positions);
          }
        }

        if (i + this.config.parallelListFetches < offsets.length) {
          await this.delay(this.config.requestDelayMs);
        }
      }
    }

    return {
      positions: allPositions,
      isComplete: failedPages === 0 && allPositions.length >= total,
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
        return { details: null, status: response.status };
      }

      const details: EightfoldPositionDetails = await response.json();
      return { details, status: response.status };
    } catch {
      return { details: null, status: null };
    }
  }

  private createRequestHeaders(
    accept: "application/json" | "text/html",
    cookies: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: accept,
      "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
    };

    if (cookies.trim().length > 0) {
      headers.Cookie = cookies;
    }

    return headers;
  }

  private mapPositionToScrapedJob(
    baseUrl: string,
    boardToken: string,
    position: EightfoldPosition,
    details?: EightfoldPositionDetails["data"]
  ): ScrapedJob {
    const location = details?.locations?.join(", ") || position.locations?.join(", ") || "";
    const { description, descriptionFormat } = this.processDescription(details?.jobDescription || "");

    return {
      externalId: this.generateExternalId(this.platform, boardToken, position.id),
      title: details?.name || position.name,
      url: details?.publicUrl || this.buildJobUrl(baseUrl, position),
      location,
      locationType: this.parseWorkLocation(details?.workLocationOption || position.workLocationOption),
      department: details?.department || position.department,
      description,
      descriptionFormat,
      employmentType: parseEmploymentType(details?.efcustomTextTimeType?.[0]),
      postedDate: this.parsePostedDate(position.postedTs),
    };
  }

  private processDescription(description: string): { description: string | undefined; descriptionFormat: "markdown" | "plain" } {
    if (!description) {
      return { description: undefined, descriptionFormat: "plain" };
    }

    const result = processDescription(description, "html");
    return {
      description: result.text ?? undefined,
      descriptionFormat: result.format,
    };
  }

  private buildJobUrl(baseUrl: string, position: EightfoldPosition): string {
    if (position.positionUrl) {
      if (position.positionUrl.startsWith("http")) {
        return position.positionUrl;
      }
      return `${baseUrl}${position.positionUrl}`;
    }
    return `${baseUrl}/careers/job/${position.id}`;
  }

  private parseWorkLocation(option?: string): "remote" | "hybrid" | "onsite" | undefined {
    if (!option) return undefined;
    const lower = option.toLowerCase();
    if (lower === "remote_local" || lower === "remote") return "remote";
    if (lower === "hybrid") return "hybrid";
    if (lower === "onsite") return "onsite";
    return undefined;
  }

  private parsePostedDate(postedTs: number): Date | undefined {
    if (!postedTs) return undefined;
    return new Date(postedTs * 1000);
  }
}

export function createEightfoldScraper(
  httpClient: IHttpClient,
  browserClient: IBrowserClient,
  config?: Partial<EightfoldConfig>
): EightfoldScraper {
  return new EightfoldScraper(httpClient, browserClient, config);
}
