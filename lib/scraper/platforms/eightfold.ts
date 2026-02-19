import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import type { IBrowserClient, BrowserSession } from "@/lib/scraper/infrastructure/browser-client";
import type { ScraperResult, ScrapeOptions, ScrapedJob, BrowserScraperConfig, EarlyFilterStats, JobFilters } from "@/lib/scraper/types";
import { processDescription } from "@/lib/jobs/description-processor";
import { matchesPreferredCountry, matchesPreferredCity, matchesTitleKeywords } from "@/lib/scraper/services/filter-service";
import { AbstractBrowserScraper, DEFAULT_BROWSER_CONFIG } from "../core";

interface FilterableItem {
  title?: string;
  location?: string;
}

function applyEarlyFilters<T extends FilterableItem>(items: T[], filters: JobFilters): { filtered: T[]; filteredOut: number } {
  if (!filters.country && !filters.city && (!filters.titleKeywords || filters.titleKeywords.length === 0)) {
    return { filtered: items, filteredOut: 0 };
  }

  const originalCount = items.length;
  const filtered = items.filter((item) => {
    if (filters.country && !matchesPreferredCountry(item.location, filters.country)) {
      return false;
    }
    if (filters.city && !matchesPreferredCity(item.location, filters.city)) {
      return false;
    }
    if (filters.titleKeywords && filters.titleKeywords.length > 0 && !matchesTitleKeywords(item.title, filters.titleKeywords)) {
      return false;
    }
    return true;
  });

  return { filtered, filteredOut: originalCount - filtered.length };
}

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

export type EightfoldConfig = BrowserScraperConfig & {
  pageSize: number;
  parallelListFetches: number;
  detailBatchSize: number;
  requestDelayMs: number;
};

export const DEFAULT_EIGHTFOLD_CONFIG: EightfoldConfig = {
  ...DEFAULT_BROWSER_CONFIG,
  pageSize: 10,
  parallelListFetches: 5,
  detailBatchSize: 10,
  requestDelayMs: 100,
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
          jobs: [],
          error: "Could not parse Eightfold URL.",
        };
      }

      const isDirectEightfold = url.toLowerCase().includes("eightfold.ai");
      let domain: string | undefined = options?.boardToken;
      let baseUrl: string = parsedUrl.baseUrl;
      let detectedBoardToken: string | undefined;

      if (!domain) {
        if (isDirectEightfold) {
          const apiDetectedDomain = await this.detectDomainFromApi(parsedUrl.baseUrl);
          domain = apiDetectedDomain || (parsedUrl.subdomain ? `${parsedUrl.subdomain}.com` : parsedUrl.domain);
        } else {
          const session = await this.bootstrapSession(url);

          if (!session || !session.domain) {
            return {
              success: false,
              jobs: [],
              error: "Failed to detect Eightfold domain. This may not be an Eightfold-powered careers page.",
            };
          }

          domain = session.domain;
          baseUrl = session.baseUrl;
          detectedBoardToken = domain;

          console.log(`[Scraper] Unknown - Bootstrapped browser session (domain: ${domain})`);
        }
      }

      if (!domain) {
        return {
          success: false,
          jobs: [],
          error: "Could not detect Eightfold domain.",
        };
      }

      const filters: JobFilters | undefined = options?.filters;
      const existingExternalIds = options?.existingExternalIds;
      const boardToken = domain.replace(/\.com$/i, "");

      const listResult = await this.fetchAllPositions(baseUrl, domain);
      if (!listResult) {
        return {
          success: true,
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : domain),
          openExternalIds: [],
          openExternalIdsComplete: false,
        };
      }

      const allPositions = listResult.positions;
      const openExternalIds = allPositions.map((position) =>
        this.generateExternalId(this.platform, boardToken, position.id)
      );

      if (allPositions.length === 0) {
        return {
          success: true,
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : domain),
          openExternalIds,
          openExternalIdsComplete: listResult.isComplete,
        };
      }

      let positionsToProcess = allPositions;
      let earlyFilteredOut = 0;
      let earlyFilterStats: EarlyFilterStats | undefined;

      if (filters && (filters.country || filters.city || (filters.titleKeywords && filters.titleKeywords.length > 0))) {
        const filterablePositions = allPositions.map((pos) => ({
          ...pos,
          title: pos.name,
          location: pos.locations?.join(", ") || "",
        }));

        const { filtered, filteredOut } = applyEarlyFilters(filterablePositions, filters);
        positionsToProcess = filtered as EightfoldPosition[];
        earlyFilteredOut = filteredOut;

        if (earlyFilteredOut > 0) {
          earlyFilterStats = {
            total: earlyFilteredOut,
            country: filters.country ? earlyFilteredOut : undefined,
            title: filters.titleKeywords && filters.titleKeywords.length > 0 ? earlyFilteredOut : undefined,
          };
        }
      }

      if (positionsToProcess.length === 0) {
        return {
          success: true,
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : domain),
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
        return {
          success: true,
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : domain),
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          openExternalIdsComplete: listResult.isComplete,
        };
      }

      const scrapedJobs: ScrapedJob[] = [];

      for (let i = 0; i < positionsToFetch.length; i += this.config.detailBatchSize) {
        const batch = positionsToFetch.slice(i, i + this.config.detailBatchSize);

        const detailPromises = batch.map(async (position) => {
          const details = await this.fetchPositionDetails(baseUrl, domain!, position.id);
          return this.mapPositionToScrapedJob(baseUrl, boardToken, position, details?.data);
        });

        const results = await Promise.all(detailPromises);
        scrapedJobs.push(...results);

        if (i + this.config.detailBatchSize < positionsToFetch.length) {
          await this.delay(this.config.requestDelayMs);
        }
      }

      return {
        success: true,
        jobs: scrapedJobs,
        detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : domain),
        earlyFiltered: earlyFilterStats,
        openExternalIds,
        openExternalIdsComplete: listResult.isComplete,
      };
    } catch (error) {
      return {
        success: false,
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

  private async detectDomainFromApi(baseUrl: string): Promise<string | null> {
    try {
      const response = await this.httpClient.fetch(`${baseUrl}/api/pcsx/job_cart`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
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
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
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
    start: number = 0
  ): Promise<EightfoldSearchResponse | null> {
    const url = `${baseUrl}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=${start}&sort_by=timestamp`;

    try {
      const response = await this.httpClient.fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
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
    domain: string
  ): Promise<EightfoldListFetchResult | null> {
    const firstBatch = await this.fetchJobList(baseUrl, domain, 0);

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
        return this.fetchJobList(baseUrl, domain, offset);
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
    positionId: number
  ): Promise<EightfoldPositionDetails | null> {
    const url = `${baseUrl}/api/pcsx/position_details?position_id=${positionId}&domain=${encodeURIComponent(domain)}&hl=en`;

    try {
      const response = await this.httpClient.fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
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
      employmentType: details?.efcustomTextTimeType?.[0]?.toLowerCase() as "full-time" | "part-time" | "contract" | "intern" | "temporary" | undefined,
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
