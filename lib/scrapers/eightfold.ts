import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";

import { AbstractScraper, ScraperResult, ScrapeOptions, ScrapedJob } from "./base-scraper";
import { processDescription } from "@/lib/jobs/description-processor";
import { applyFilters, type JobFilterOptions } from "@/lib/jobs/filter-utils";

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

interface ParsedEightfoldUrl {
  domain: string;
  subdomain: string | null;
  baseUrl: string;
}

interface EightfoldSession {
  domain: string;
  baseUrl: string;
}

const PAGE_SIZE = 10;
const PARALLEL_LIST_FETCHES = 5;
const DETAIL_BATCH_SIZE = 10;
const REQUEST_DELAY_MS = 100;

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class EightfoldScraper extends AbstractScraper {
  platform = "eightfold";

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return urlLower.includes("eightfold.ai");
  }

  private parseUrl(url: string): ParsedEightfoldUrl | null {
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

  private async bootstrapSession(url: string, parsedUrl: ParsedEightfoldUrl): Promise<EightfoldSession | null> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      console.log(`[Eightfold] Bootstrapping session for ${url}`);

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

      let detectedDomain: string | null = null;
      let detectedBaseUrl: string | null = null;

      page.on("request", (request) => {
        const requestUrl = request.url();
        if (requestUrl.includes("/api/pcsx/")) {
          const urlObj = new URL(requestUrl);
          const domainParam = urlObj.searchParams.get("domain");
          if (domainParam && !detectedDomain) {
            detectedDomain = domainParam;
            console.log(`[Eightfold] Detected domain from request: ${detectedDomain}`);
          }
          // Capture the base URL from API calls
          if (!detectedBaseUrl) {
            detectedBaseUrl = `${urlObj.protocol}//${urlObj.host}`;
            console.log(`[Eightfold] Detected baseUrl from API: ${detectedBaseUrl}`);
          }
        }
      });

      page.on("response", (response) => {
        const responseUrl = response.url();
        if (responseUrl.includes("/api/pcsx/") && !detectedDomain) {
          const urlObj = new URL(responseUrl);
          const domainParam = urlObj.searchParams.get("domain");
          if (domainParam) {
            detectedDomain = domainParam;
            console.log(`[Eightfold] Detected domain from response URL: ${detectedDomain}`);
          }
          if (!detectedBaseUrl) {
            detectedBaseUrl = `${urlObj.protocol}//${urlObj.host}`;
            console.log(`[Eightfold] Detected baseUrl from API: ${detectedBaseUrl}`);
          }
        }
      });

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      await page.waitForTimeout(3000);

      // Get the final URL after any redirects
      const finalUrl = page.url();
      const finalUrlObj = new URL(finalUrl);
      const finalBaseUrl = `${finalUrlObj.protocol}//${finalUrlObj.host}`;
      
      if (finalBaseUrl !== parsedUrl.baseUrl) {
        console.log(`[Eightfold] URL redirected from ${parsedUrl.baseUrl} to ${finalBaseUrl}`);
      }

      // Use detected baseUrl from API calls, or fall back to final page URL
      if (!detectedBaseUrl) {
        detectedBaseUrl = finalBaseUrl;
      }

      if (!detectedDomain) {
        const pageContent = await page.content();
        const domainMatch = pageContent.match(/domain["\s:=]+(["']?)([^"'\s,)}]+)\1/i);
        if (domainMatch) {
          detectedDomain = domainMatch[2];
          console.log(`[Eightfold] Detected domain from page content: ${detectedDomain}`);
        }
      }

      if (!detectedDomain) {
        console.error("[Eightfold] Bootstrap failed - could not detect domain");
        return null;
      }

      console.log(`[Eightfold] Session bootstrap successful - domain: ${detectedDomain}, baseUrl: ${detectedBaseUrl}`);
      return {
        domain: detectedDomain,
        baseUrl: detectedBaseUrl,
      };
    } catch (error) {
      console.error("[Eightfold] Session bootstrap failed:", error);
      return null;
    } finally {
      if (context) await context.close();
      if (browser) await browser.close();
    }
  }

  private async probePcsxApi(baseUrl: string, domain: string): Promise<boolean> {
    try {
      const probeUrl = `${baseUrl}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=0&num=1`;
      const response = await this.fetchWithRetry(probeUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      if (!response.ok) return false;

      const data: EightfoldSearchResponse = await response.json();
      return data.status === 200 && data.data !== undefined;
    } catch {
      return false;
    }
  }

  private async detectDomainFromApi(baseUrl: string): Promise<string | null> {
    try {
      const response = await this.fetchWithRetry(`${baseUrl}/api/pcsx/job_cart`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      if (response.ok) {
        const text = await response.text();
        const domainMatch = text.match(/"domain"\s*:\s*"([^"]+)"/);
        if (domainMatch) {
          return domainMatch[1];
        }
      }

      const pageResponse = await this.fetchWithRetry(baseUrl, {
        headers: {
          Accept: "text/html",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
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
    // Note: Eightfold PCSX API has a hard limit of 10 items per page (num parameter is ignored)
    const url = `${baseUrl}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=${start}&sort_by=timestamp`;

    try {
      const response = await this.fetchWithRetry(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      console.error("[Eightfold] Failed to fetch job list:", error);
      return null;
    }
  }

  private async fetchAllJobs(
    baseUrl: string,
    domain: string,
    filters?: JobFilterOptions
  ): Promise<{ jobs: EightfoldPosition[]; filteredOut: number }> {
    const firstBatch = await this.fetchJobList(baseUrl, domain, 0);

    if (!firstBatch || firstBatch.status !== 200 || !firstBatch.data) {
      return { jobs: [], filteredOut: 0 };
    }

    const total = firstBatch.data.count || 0;
    const allJobs = [...firstBatch.data.positions];
    console.log(`[Eightfold] First batch: ${allJobs.length} jobs, total: ${total}`);

    if (total > PAGE_SIZE) {
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const offsets: number[] = [];

      for (let page = 1; page < totalPages; page++) {
        offsets.push(page * PAGE_SIZE);
      }

      // Parallel fetch with staggering
      const fetchWithStagger = async (offset: number, index: number): Promise<EightfoldSearchResponse | null> => {
        const staggerDelay = index * 50;
        await delay(staggerDelay);
        return this.fetchJobList(baseUrl, domain, offset);
      };

      for (let i = 0; i < offsets.length; i += PARALLEL_LIST_FETCHES) {
        const batchOffsets = offsets.slice(i, i + PARALLEL_LIST_FETCHES);
        const results = await Promise.all(
          batchOffsets.map((offset, idx) => fetchWithStagger(offset, idx))
        );

        for (const result of results) {
          if (result?.data?.positions?.length) {
            allJobs.push(...result.data.positions);
          }
        }

        if (i + PARALLEL_LIST_FETCHES < offsets.length) {
          await delay(REQUEST_DELAY_MS);
        }
      }
    }

    console.log(`[Eightfold] Fetched ${allJobs.length} total job list items`);

    if (filters && (filters.country || filters.city || (filters.titleKeywords && filters.titleKeywords.length > 0))) {
      const filterableJobs = allJobs.map((job) => ({
        ...job,
        title: job.name,
        location: job.locations?.join(", ") || "",
      }));

      const { filtered, filteredOut } = applyFilters(filterableJobs, filters);
      console.log(`[Eightfold] Early filter: ${filtered.length}/${allJobs.length} jobs passed (filtered out ${filteredOut})`);

      return {
        jobs: filtered as EightfoldPosition[],
        filteredOut,
      };
    }

    return { jobs: allJobs, filteredOut: 0 };
  }

  private async fetchPositionDetails(
    baseUrl: string,
    domain: string,
    positionId: number
  ): Promise<EightfoldPositionDetails | null> {
    const url = `${baseUrl}/api/pcsx/position_details?position_id=${positionId}&domain=${encodeURIComponent(domain)}&hl=en`;

    try {
      const response = await this.fetchWithRetry(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      if (!response.ok) return null;
      return response.json();
    } catch (error) {
      console.error(`[Eightfold] Failed to fetch position ${positionId}:`, error);
      return null;
    }
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
      employmentType: details?.efcustomTextTimeType?.[0]?.toLowerCase(),
      postedDate: this.parsePostedDate(position.postedTs),
    };
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
          // For direct eightfold.ai URLs, try quick detection first
          const apiDetectedDomain = await this.detectDomainFromApi(parsedUrl.baseUrl);
          domain = apiDetectedDomain || (parsedUrl.subdomain ? `${parsedUrl.subdomain}.com` : parsedUrl.domain);
        } else {
          // For custom URLs, always bootstrap with Playwright to:
          // 1. Follow redirects to the actual careers page
          // 2. Intercept real API calls to get the correct domain
          // 3. Get the actual baseUrl for API calls
          console.log(`[Eightfold] Custom domain detected, bootstrapping with Playwright...`);
          const session = await this.bootstrapSession(url, parsedUrl);
          
          if (!session) {
            return {
              success: false,
              jobs: [],
              error: "Failed to detect Eightfold domain. This may not be an Eightfold-powered careers page.",
            };
          }
          
          domain = session.domain;
          baseUrl = session.baseUrl;
          detectedBoardToken = domain;
        }
      }

      console.log(`[Eightfold] Using domain: ${domain}, baseUrl: ${baseUrl}`);

      const filters: JobFilterOptions | undefined = options?.filters;
      const existingExternalIds = options?.existingExternalIds;
      const boardToken = domain.replace(/\.com$/i, "");

      const { jobs: filteredJobs, filteredOut: earlyFilteredOut } = await this.fetchAllJobs(
        baseUrl,
        domain,
        filters
      );

      if (filteredJobs.length === 0) {
        console.log(`[Eightfold] No jobs to process after filtering (filtered out ${earlyFilteredOut})`);
        return {
          success: true,
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : domain),
        };
      }

      let jobsToFetch = filteredJobs;
      let earlyDedupedOut = 0;

      if (existingExternalIds && existingExternalIds.size > 0) {
        jobsToFetch = filteredJobs.filter((job) => {
          const externalId = this.generateExternalId(this.platform, boardToken, job.id);
          return !existingExternalIds.has(externalId);
        });
        earlyDedupedOut = filteredJobs.length - jobsToFetch.length;
        console.log(`[Eightfold] Early dedupe: ${jobsToFetch.length}/${filteredJobs.length} are new (skipped ${earlyDedupedOut} existing)`);
      }

      if (jobsToFetch.length === 0) {
        console.log(`[Eightfold] All ${filteredJobs.length} filtered jobs already exist - no new jobs to fetch`);
        return {
          success: true,
          jobs: [],
          detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : domain),
        };
      }

      console.log(`[Eightfold] Fetching details for ${jobsToFetch.length} new jobs (filtered: ${earlyFilteredOut}, deduped: ${earlyDedupedOut})...`);

      const scrapedJobs: ScrapedJob[] = [];

      for (let i = 0; i < jobsToFetch.length; i += DETAIL_BATCH_SIZE) {
        const batch = jobsToFetch.slice(i, i + DETAIL_BATCH_SIZE);

        const detailPromises = batch.map(async (position) => {
          const details = await this.fetchPositionDetails(baseUrl, domain!, position.id);
          return this.mapPositionToScrapedJob(baseUrl, boardToken, position, details?.data);
        });

        const results = await Promise.all(detailPromises);
        scrapedJobs.push(...results);

        const batchNum = Math.floor(i / DETAIL_BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(jobsToFetch.length / DETAIL_BATCH_SIZE);
        console.log(`[Eightfold] Detail batch ${batchNum}/${totalBatches}: got ${results.length}/${batch.length} jobs`);

        if (i + DETAIL_BATCH_SIZE < jobsToFetch.length) {
          await delay(REQUEST_DELAY_MS);
        }
      }

      console.log(`[Eightfold] Completed: ${scrapedJobs.length} new jobs (filtered: ${earlyFilteredOut}, deduped: ${earlyDedupedOut})`);

      return {
        success: true,
        jobs: scrapedJobs,
        detectedBoardToken: detectedBoardToken || (options?.boardToken ? undefined : domain),
      };
    } catch (error) {
      console.error("[Eightfold Scraper] Error:", error);
      return {
        success: false,
        jobs: [],
        error: error instanceof Error ? error.message : "An internal error occurred while scraping jobs",
      };
    }
  }
}
