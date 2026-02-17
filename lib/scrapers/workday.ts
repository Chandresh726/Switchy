import { chromium, Browser, BrowserContext } from "playwright";
import { AbstractScraper, ScraperResult, ScrapeOptions, ScrapedJob } from "./base-scraper";
import { processDescription, containsHtml } from "@/lib/jobs/description-processor";
import { applyFilters, type JobFilterOptions } from "@/lib/jobs/filter-utils";

interface WorkdayJobListItem {
  title: string;
  externalPath: string;
  locationsText: string;
  postedOn: string;
  remoteType: string;
  bulletFields: string[];
}

interface WorkdayJobListResponse {
  total: number;
  jobPostings: WorkdayJobListItem[];
}

interface WorkdayJobDetailResponse {
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
}

interface WorkdaySession {
  cookies: string;
  csrfToken: string;
  baseUrl: string;
  tenant: string;
  board: string;
}

interface ParsedWorkdayUrl {
  baseUrl: string;
  tenant: string;
  board: string;
}

const PARALLEL_LIST_FETCHES = 2;
const DETAIL_BATCH_SIZE = 5;
const LIST_PAGE_SIZE = 20;
const REQUEST_DELAY_BASE_MS = 800;
const REQUEST_DELAY_JITTER_MS = 200;

function getRandomDelay(): number {
  return REQUEST_DELAY_BASE_MS + Math.floor(Math.random() * REQUEST_DELAY_JITTER_MS * 2) - REQUEST_DELAY_JITTER_MS;
}

async function delayWithJitter(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, getRandomDelay()));
}

export class WorkdayScraper extends AbstractScraper {
  platform = "workday";

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return (
      urlLower.includes("myworkdayjobs.com") ||
      /\.wd\d*\.myworkdayjobs\.com/.test(urlLower)
    );
  }

  private parseUrl(url: string): ParsedWorkdayUrl | null {
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

  private async bootstrapSession(parsedUrl: ParsedWorkdayUrl): Promise<WorkdaySession | null> {
    const { baseUrl, tenant, board } = parsedUrl;
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      console.log(`[Workday] Bootstrapping session for ${baseUrl}/${board}`);
      
      browser = await chromium.launch({ 
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-features=IsolateOrigins,site-per-process",
        ],
      });

      context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 },
        locale: "en-US",
      });

      const page = await context.newPage();

      let csrfToken: string | null = null;
      let cookies: string | null = null;

      page.on("request", (request) => {
        const headers = request.headers();
        if (headers["x-calypso-csrf-token"] && !csrfToken) {
          csrfToken = headers["x-calypso-csrf-token"];
        }
      });

      page.on("response", (response) => {
        const url = response.url();
        if (url.includes("/wday/cxs/") && url.endsWith("/jobs") && !cookies) {
          const request = response.request();
          const cookieHeader = request.headers()["cookie"];
          if (cookieHeader) {
            cookies = cookieHeader;
          }
        }
      });

      await page.goto(`${baseUrl}/${board}`, { 
        waitUntil: "domcontentloaded",
        timeout: 30000 
      });

      await page.waitForTimeout(3000);

      if (!csrfToken) {
        const calypsoToken = await context.cookies().then(c => c.find(x => x.name === "CALYPSO_CSRF_TOKEN"));
        if (calypsoToken) csrfToken = calypsoToken.value;
      }

      if (!cookies) {
        const allCookies = await context.cookies();
        cookies = allCookies.map(c => `${c.name}=${c.value}`).join("; ");
      }

      if (!csrfToken || !cookies) {
        console.error(`[Workday] Bootstrap failed - csrfToken: ${!!csrfToken}, cookies: ${!!cookies}`);
        return null;
      }

      console.log("[Workday] Session bootstrap successful");
      return { cookies, csrfToken, baseUrl, tenant, board };
    } catch (error) {
      console.error("[Workday] Session bootstrap failed:", error);
      return null;
    } finally {
      if (context) await context.close();
      if (browser) await browser.close();
    }
  }

  private async fetchJobListPage(
    session: WorkdaySession,
    offset: number = 0,
    limit: number = LIST_PAGE_SIZE
  ): Promise<WorkdayJobListResponse | null> {
    const url = `${session.baseUrl}/wday/cxs/${session.tenant}/${session.board}/jobs`;
    
    try {
      const response = await this.fetchWithRetry(
        url,
        {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Cookie": session.cookies,
            "x-calypso-csrf-token": session.csrfToken,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          body: JSON.stringify({
            appliedFacets: {},
            limit,
            offset,
            searchText: "",
          }),
        },
        3,
        2000
      );

      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  private async fetchAllJobLists(
    session: WorkdaySession,
    filters?: JobFilterOptions
  ): Promise<{ jobs: WorkdayJobListItem[]; filteredOut: number }> {
    const firstBatch = await this.fetchJobListPage(session, 0, LIST_PAGE_SIZE);
    
    if (!firstBatch || !firstBatch.jobPostings) {
      return { jobs: [], filteredOut: 0 };
    }

    const total = firstBatch.total || 0;
    const allJobs = [...firstBatch.jobPostings];
    console.log(`[Workday] First batch: ${allJobs.length} jobs, total: ${total}`);

    if (total > LIST_PAGE_SIZE) {
      const totalPages = Math.ceil(total / LIST_PAGE_SIZE);
      const offsets: number[] = [];
      
      for (let page = 1; page < totalPages; page++) {
        offsets.push(page * LIST_PAGE_SIZE);
      }

      const fetchWithDelay = async (offset: number, index: number): Promise<WorkdayJobListResponse | null> => {
        const staggerDelay = 300 + index * 400 + Math.floor(Math.random() * 200);
        await new Promise(r => setTimeout(r, staggerDelay));
        return this.fetchJobListPage(session, offset, LIST_PAGE_SIZE);
      };

      const batchSize = PARALLEL_LIST_FETCHES;
      for (let i = 0; i < offsets.length; i += batchSize) {
        const batchOffsets = offsets.slice(i, i + batchSize);
        const results = await Promise.all(
          batchOffsets.map((offset, idx) => fetchWithDelay(offset, idx))
        );
        
        for (const result of results) {
          if (result?.jobPostings?.length) {
            allJobs.push(...result.jobPostings);
          }
        }

        if (i + batchSize < offsets.length) {
          await delayWithJitter();
        }
      }
    }

    console.log(`[Workday] Fetched ${allJobs.length} total job list items`);

    if (filters && (filters.country || filters.city || (filters.titleKeywords && filters.titleKeywords.length > 0))) {
      const filterableJobs = allJobs.map(job => ({
        ...job,
        title: job.title,
        location: job.locationsText,
      }));

      const { filtered, filteredOut } = applyFilters(filterableJobs, filters);
      console.log(`[Workday] Early filter: ${filtered.length}/${allJobs.length} jobs passed (filtered out ${filteredOut})`);
      
      return { 
        jobs: filtered as WorkdayJobListItem[], 
        filteredOut 
      };
    }

    return { jobs: allJobs, filteredOut: 0 };
  }

  private async fetchJobDetail(
    session: WorkdaySession,
    jobPostingId: string
  ): Promise<WorkdayJobDetailResponse | null> {
    const url = `${session.baseUrl}/wday/cxs/${session.tenant}/${session.board}/job/${jobPostingId}`;
    
    try {
      const response = await this.fetchWithRetry(
        url,
        {
          method: "GET",
          headers: {
            "Accept": "application/json",
            "Cookie": session.cookies,
            "x-calypso-csrf-token": session.csrfToken,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        },
        3,
        1000
      );

      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
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
    const match = postedOn.match(/(\d+)/);
    if (!match) return undefined;
    const days = parseInt(match[1], 10);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
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

    return { description, descriptionFormat: "plain" };
  }

  private async processJobBatch(
    session: WorkdaySession,
    jobs: WorkdayJobListItem[]
  ): Promise<ScrapedJob[]> {
    const detailPromises = jobs.map(async (job) => {
      try {
        const jobPostingId = job.externalPath?.split("/").pop() || job.bulletFields?.[1];
        
        if (!jobPostingId) return null;

        const detail = await this.fetchJobDetail(session, jobPostingId);
        
        if (!detail?.jobPostingInfo) return null;
        
        const externalId = this.generateExternalId(this.platform, session.board, jobPostingId);
        const jobUrl = detail.jobPostingInfo.externalUrl || 
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
          employmentType: detail.jobPostingInfo.timeType?.toLowerCase(),
          postedDate: this.parsePostedDate(job.postedOn),
        } as ScrapedJob;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(detailPromises);
    return results.filter((j): j is ScrapedJob => j !== null);
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const parsedUrl = this.parseUrl(url);
      
      if (!parsedUrl) {
        return {
          success: false,
          jobs: [],
          error: "Could not parse Workday URL. Expected format: https://company.wd5.myworkdayjobs.com/board",
        };
      }

      const session = await this.bootstrapSession(parsedUrl);
      
      if (!session) {
        return {
          success: false,
          jobs: [],
          error: "Failed to establish session with Workday. The site may have bot protection enabled.",
        };
      }

      const filters: JobFilterOptions | undefined = options?.filters;
      const existingExternalIds = options?.existingExternalIds;
      
      const { jobs: filteredJobs, filteredOut: earlyFilteredOut } = await this.fetchAllJobLists(session, filters);
      
      if (filteredJobs.length === 0) {
        console.log(`[Workday] No jobs to process after filtering (filtered out ${earlyFilteredOut})`);
        return {
          success: true,
          jobs: [],
        };
      }

      // Early deduplication - skip jobs we already have
      let jobsToFetch = filteredJobs;
      let earlyDedupedOut = 0;
      
      if (existingExternalIds && existingExternalIds.size > 0) {
        jobsToFetch = filteredJobs.filter((job) => {
          const jobPostingId = job.externalPath?.split("/").pop() || job.bulletFields?.[1];
          if (!jobPostingId) return false;
          const externalId = this.generateExternalId(this.platform, session.board, jobPostingId);
          return !existingExternalIds.has(externalId);
        });
        earlyDedupedOut = filteredJobs.length - jobsToFetch.length;
        console.log(`[Workday] Early dedupe: ${jobsToFetch.length}/${filteredJobs.length} are new (skipped ${earlyDedupedOut} existing)`);
      }

      if (jobsToFetch.length === 0) {
        console.log(`[Workday] All ${filteredJobs.length} filtered jobs already exist - no new jobs to fetch`);
        return {
          success: true,
          jobs: [],
        };
      }

      console.log(`[Workday] Fetching details for ${jobsToFetch.length} new jobs (filtered: ${earlyFilteredOut}, deduped: ${earlyDedupedOut})...`);
      const scrapedJobs: ScrapedJob[] = [];

      for (let i = 0; i < jobsToFetch.length; i += DETAIL_BATCH_SIZE) {
        const batch = jobsToFetch.slice(i, i + DETAIL_BATCH_SIZE);
        const results = await this.processJobBatch(session, batch);
        scrapedJobs.push(...results);
        
        const batchNum = Math.floor(i / DETAIL_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(jobsToFetch.length / DETAIL_BATCH_SIZE);
        console.log(`[Workday] Detail batch ${batchNum}/${totalBatches}: got ${results.length}/${batch.length} jobs`);

        if (i + DETAIL_BATCH_SIZE < jobsToFetch.length) {
          await delayWithJitter();
        }
      }

      console.log(`[Workday] Completed: ${scrapedJobs.length} new jobs (filtered: ${earlyFilteredOut}, deduped: ${earlyDedupedOut})`);

      return {
        success: true,
        jobs: scrapedJobs,
      };
    } catch (error) {
      console.error("[Workday Scraper] Error:", error);
      return {
        success: false,
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
