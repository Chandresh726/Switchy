import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import type { IBrowserClient, BrowserSession } from "@/lib/scraper/infrastructure/browser-client";
import type { ScraperResult, ScrapeOptions, ScrapedJob, BrowserScraperConfig, EarlyFilterStats, JobFilters } from "@/lib/scraper/types";
import { processDescription, containsHtml } from "@/lib/jobs/description-processor";
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
    id: string;
    title: string;
    jobDescription: string;
    location: string;
    postedOn: string;
    startDate: string;
    timeType: string;
    jobReqId: string;
    jobPostingId: string;
    remoteType: string;
    externalUrl: string;
    country?: { descriptor: string };
  };
};

type WorkdaySession = BrowserSession & {
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
        return {
          success: false,
          jobs: [],
          error: "Could not parse Workday URL. Expected format: https://company.wd5.myworkdayjobs.com/board",
        };
      } else {
        detectedBoardToken = `${parsedUrl.tenant}/${parsedUrl.board}`;
      }

      const session = await this.bootstrapSession(
        `${parsedUrl.baseUrl}/${parsedUrl.board}`
      );

      if (!session || !session.csrfToken || !session.cookies) {
        return {
          success: false,
          jobs: [],
          error: "Failed to establish session with Workday. The site may have bot protection enabled.",
        };
      }

      console.log(`[Scraper] Unknown - Bootstrapped browser session (tenant: ${parsedUrl.tenant}/${parsedUrl.board})`);

      const workdaySession: WorkdaySession = {
        ...session,
        tenant: parsedUrl.tenant,
        board: parsedUrl.board,
      };

      const filters: JobFilters | undefined = options?.filters;
      const existingExternalIds = options?.existingExternalIds;

      const listResult = await this.fetchAllJobListItems(workdaySession);
      if (!listResult) {
        return {
          success: true,
          jobs: [],
          detectedBoardToken,
          openExternalIds: [],
          openExternalIdsComplete: false,
        };
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
        return {
          success: true,
          jobs: [],
          detectedBoardToken,
          openExternalIds,
          openExternalIdsComplete: listResult.isComplete,
        };
      }

      let jobsToProcess = allJobListItems;
      let earlyFilterStats: EarlyFilterStats | undefined;

      if (filters && (filters.country || filters.city || (filters.titleKeywords && filters.titleKeywords.length > 0))) {
        const filterableJobs = allJobListItems.map((job) => ({
          ...job,
          title: job.title,
          location: job.locationsText,
        }));

        const { filtered, filteredOut } = applyEarlyFilters(filterableJobs, filters);
        jobsToProcess = filtered as WorkdayJobListItem[];

        if (filteredOut > 0) {
          earlyFilterStats = {
            total: filteredOut,
            country: filters.country ? filteredOut : undefined,
            title: filters.titleKeywords && filters.titleKeywords.length > 0 ? filteredOut : undefined,
          };
        }
      }

      if (jobsToProcess.length === 0) {
        return {
          success: true,
          jobs: [],
          detectedBoardToken,
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          openExternalIdsComplete: listResult.isComplete,
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
        return {
          success: true,
          jobs: [],
          detectedBoardToken,
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          openExternalIdsComplete: listResult.isComplete,
        };
      }

      const scrapedJobs: ScrapedJob[] = [];

      for (let i = 0; i < jobsToFetch.length; i += this.config.detailBatchSize) {
        const batch = jobsToFetch.slice(i, i + this.config.detailBatchSize);
        const results = await this.processJobBatch(workdaySession, batch);
        scrapedJobs.push(...results);

        if (i + this.config.detailBatchSize < jobsToFetch.length) {
          await this.delayWithJitter();
        }
      }

      return {
        success: true,
        jobs: scrapedJobs,
        detectedBoardToken,
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
      const response = await this.post<WorkdayJobListResponse>(
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
          "x-calypso-csrf-token": session.csrfToken!,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        }
      );

      return response;
    } catch {
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
        return this.fetchJobListPage(session, offset, this.config.listPageSize);
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
      const response = await this.fetch<WorkdayJobDetailResponse>(url, {
        Accept: "application/json",
        Cookie: session.cookies,
        "x-calypso-csrf-token": session.csrfToken!,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      });

      return response;
    } catch {
      return null;
    }
  }

  private async processJobBatch(
    session: WorkdaySession,
    jobs: WorkdayJobListItem[]
  ): Promise<ScrapedJob[]> {
    const detailPromises = jobs.map(async (job) => {
      try {
        const jobPostingId = this.getJobPostingId(job);

        if (!jobPostingId) return null;

        const detail = await this.fetchJobDetail(session, jobPostingId);

        if (!detail?.jobPostingInfo) return null;

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
          employmentType: detail.jobPostingInfo.timeType?.toLowerCase() as "full-time" | "part-time" | "contract" | "intern" | "temporary" | undefined,
          postedDate: this.parsePostedDate(job.postedOn),
        } as ScrapedJob;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(detailPromises);
    return results.filter((j): j is ScrapedJob => j !== null);
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
