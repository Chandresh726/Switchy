import { load } from "cheerio";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import type {
  ApiScraperConfig,
  EarlyFilterStats,
  EmploymentType,
  ScrapeOptions,
  ScrapedJob,
  ScraperResult,
} from "@/lib/scraper/types";
import { applyEarlyFilters, hasEarlyFilters, toEarlyFilterStats } from "@/lib/scraper/services";
import { parseEmploymentType } from "@/lib/scraper/types";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import { hydrateDetailsInBatches } from "./shared/detail-hydrator";
import { normalizeDescription } from "./shared/job-normalizers";

interface RipplingLocation {
  name: string;
  country: string;
  countryCode: string;
  state: string;
  stateCode: string | null;
  city: string;
  workplaceType: "ON_SITE" | "REMOTE" | "HYBRID";
}

interface RipplingJobEntry {
  id: string;
  name: string;
  url: string;
  department: { name: string };
  locations: RipplingLocation[];
  language: string;
}

interface RipplingJobsResponse {
  pageProps: {
    jobs: {
      items: RipplingJobEntry[];
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
    };
  };
}

interface RipplingListingJob {
  id: string;
  title: string;
  url: string;
  department: string;
  location: string;
  locationType: "remote" | "hybrid" | "onsite" | undefined;
}

interface RipplingHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

export type RipplingConfig = ApiScraperConfig & {
  detailBatchSize: number;
  detailDelayMs: number;
};

export const DEFAULT_RIPPLING_CONFIG: RipplingConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://www.rippling.com",
  detailBatchSize: 4,
  detailDelayMs: 500,
};

const BUILD_ID_REGEX = /\/_next\/static\/([^/]+)\/_buildManifest\.js/;

const LOCALE_REGEX = /^\/?(?:en-IN|en-US|en-AU|en-CA|en-GB|en-IE|en-SG|de-DE|fr-CA|fr-FR|it-IT|nl-NL|pt-PT|es-ES)/;

export class RipplingScraper extends AbstractApiScraper<RipplingConfig> {
  readonly platform = "rippling" as const;

  constructor(httpClient: IHttpClient, config: Partial<RipplingConfig> = {}) {
    super(httpClient, { ...DEFAULT_RIPPLING_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes("rippling.com/careers/open-roles") ||
      lower.includes("rippling.com/careers") ||
      (lower.includes("rippling.com") && lower.includes("career"))
    );
  }

  extractIdentifier(url: string): string | null {
    try {
      const parsed = new URL(url);
      const locale = this.extractLocaleFromPath(parsed.pathname);
      return locale || "main";
    } catch {
      return "main";
    }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const sourceUrl = new URL(url);
      const locale = this.extractLocaleFromPath(sourceUrl.pathname) || "en-IN";

      const buildId = await this.fetchBuildId();
      if (!buildId) {
        return {
          success: false,
          outcome: "error",
          jobs: [],
          openExternalIds: [],
          openExternalIdsComplete: false,
          error: "Failed to extract Rippling build ID.",
        };
      }

      const listings = await this.fetchAndGroupListings(buildId, locale);
      const openExternalIds = listings.map((job) =>
        this.generateExternalId(this.platform, job.id)
      );

      if (listings.length === 0) {
        return {
          success: true,
          outcome: "success",
          jobs: [],
          openExternalIds,
          openExternalIdsComplete: true,
        };
      }

      const filters = options?.filters;
      const existingExternalIds = options?.existingExternalIds;
      let jobsToProcess = listings;
      let earlyFilterStats: EarlyFilterStats | undefined;

      if (hasEarlyFilters(filters)) {
        const earlyFilterResult = applyEarlyFilters(
          listings.map((job) => ({
            title: job.title,
            location: job.location,
          })),
          filters
        );
        const filteredIds = new Set(
          earlyFilterResult.filtered.map((item) => item.title + "|" + item.location)
        );
        jobsToProcess = listings.filter((job) =>
          filteredIds.has(job.title + "|" + job.location)
        );
        earlyFilterStats = toEarlyFilterStats(earlyFilterResult);
      }

      if (jobsToProcess.length === 0) {
        return {
          success: true,
          outcome: "success",
          jobs: [],
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          openExternalIdsComplete: true,
        };
      }

      const jobsToFetch = existingExternalIds
        ? jobsToProcess.filter((job) => {
            const externalId = this.generateExternalId(this.platform, job.id);
            return !existingExternalIds.has(externalId);
          })
        : jobsToProcess;

      if (jobsToFetch.length === 0) {
        return {
          success: true,
          outcome: "success",
          jobs: [],
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          openExternalIdsComplete: true,
        };
      }

      const hydrated = await hydrateDetailsInBatches<
        RipplingListingJob,
        RipplingHydratedJob
      >({
        items: jobsToFetch,
        initialBatchSize: this.config.detailBatchSize,
        initialDelayMs: this.config.detailDelayMs,
        fetcher: async (job) => this.fetchAndHydrateJob(job),
      });

      let detailFailures = hydrated.failures;
      const scrapedJobs = hydrated.results.map((result) => {
        if (result.failed) detailFailures++;
        return result.job;
      });

      return {
        success: true,
        outcome: detailFailures > 0 ? "partial" : "success",
        jobs: scrapedJobs,
        earlyFiltered: earlyFilterStats,
        openExternalIds,
        openExternalIdsComplete: true,
      };
    } catch (error) {
      return {
        success: false,
        outcome: "error",
        jobs: [],
        openExternalIds: [],
        openExternalIdsComplete: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async fetchBuildId(): Promise<string | null> {
    try {
      const response = await this.httpClient.fetch(this.config.baseUrl, {
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
        headers: this.createHtmlHeaders(),
      });

      if (!response.ok) return null;

      const html = await response.text();
      const match = html.match(BUILD_ID_REGEX);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  private async fetchAndGroupListings(
    buildId: string,
    locale: string
  ): Promise<RipplingListingJob[]> {
    const dataUrl = `${this.config.baseUrl}/_next/data/${buildId}/${locale}/careers/open-roles.json`;
    const response = await this.httpClient.fetch(dataUrl, {
      timeout: this.config.timeout,
      retries: this.config.retries,
      baseDelay: this.config.baseDelay,
      headers: this.createJsonHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Rippling jobs: HTTP ${response.status}`
      );
    }

    const data = (await response.json()) as RipplingJobsResponse;
    const entries = data.pageProps?.jobs?.items ?? [];

    return this.groupAndMergeLocations(entries);
  }

  private groupAndMergeLocations(
    entries: RipplingJobEntry[]
  ): RipplingListingJob[] {
    const grouped = new Map<string, RipplingListingJob>();

    for (const entry of entries) {
      const existing = grouped.get(entry.id);

      const location = entry.locations?.[0];
      const locationName = location?.name ?? "";
      const locationType = this.mapWorkplaceType(location?.workplaceType);

      if (!existing) {
        grouped.set(entry.id, {
          id: entry.id,
          title: entry.name,
          url: entry.url,
          department: entry.department?.name ?? "",
          location: locationName,
          locationType,
        });
      } else {
        if (locationName && !existing.location.includes(locationName)) {
          existing.location = `${existing.location} | ${locationName}`;
        }
      }
    }

    return Array.from(grouped.values());
  }

  private mapWorkplaceType(
    workplaceType: string | undefined
  ): "remote" | "hybrid" | "onsite" | undefined {
    switch (workplaceType) {
      case "REMOTE":
        return "remote";
      case "HYBRID":
        return "hybrid";
      case "ON_SITE":
        return "onsite";
      default:
        return undefined;
    }
  }

  private async fetchAndHydrateJob(
    listing: RipplingListingJob
  ): Promise<RipplingHydratedJob> {
    const fallback = this.mapListingToJob(listing);

    const response = await this.httpClient.fetch(listing.url, {
      timeout: this.config.timeout,
      retries: this.config.retries,
      baseDelay: this.config.baseDelay,
      headers: this.createHtmlHeaders(),
    });

    if (!response.ok) {
      return { job: fallback, failed: true };
    }

    const html = await response.text();
    const { description, descriptionFormat } = this.extractDescription(html);
    const salary = this.extractSalary(html);
    const employmentType = this.extractEmploymentType(html);

    return {
      failed: false,
      job: {
        externalId: this.generateExternalId(this.platform, listing.id),
        title: listing.title,
        url: listing.url,
        location: listing.location,
        locationType: listing.locationType,
        department: listing.department,
        description,
        descriptionFormat,
        salary,
        employmentType,
      },
    };
  }

  private mapListingToJob(listing: RipplingListingJob): ScrapedJob {
    return {
      externalId: this.generateExternalId(this.platform, listing.id),
      title: listing.title,
      url: listing.url,
      location: listing.location,
      locationType: listing.locationType,
      department: listing.department,
    };
  }

  private extractDescription(html: string): {
    description?: string;
    descriptionFormat?: "markdown" | "plain" | "html";
  } {
    const $ = load(html);

    $("header, footer, nav, script, style, noscript").remove();

    const mainContent =
      $("main").html() ||
      $('[role="main"]').html() ||
      $(".job-description").html() ||
      $("article").html() ||
      $("body").html() ||
      "";

    if (!mainContent.trim()) {
      return {};
    }

    const cleaned = mainContent
      .replace(/Apply now/gi, "")
      .replace(/Share on:/gi, "")
      .replace(/Powered by Rippling/gi, "")
      .replace(/Terms of service|Privacy|Cookies/gi, "");

    const normalized = normalizeDescription(cleaned);
    return {
      description: normalized.description,
      descriptionFormat: normalized.descriptionFormat,
    };
  }

  private extractSalary(html: string): string | undefined {
    const salaryMatch = html.match(
      /(?:pay range|salary|compensation)[^$]*\$\s*([\d,]+)\s*[-–]\s*\$\s*([\d,]+)/i
    );
    if (salaryMatch) {
      return `$${salaryMatch[1]} - $${salaryMatch[2]}`;
    }
    return undefined;
  }

  private extractEmploymentType(html: string): EmploymentType | undefined {
    const lower = html.toLowerCase();
    const type =
      lower.includes("full-time") || lower.includes("full time") ? "full-time"
      : lower.includes("part-time") || lower.includes("part time") ? "part-time"
      : lower.includes("contract") ? "contract"
      : lower.includes("intern") ? "intern"
      : undefined;
    return parseEmploymentType(type);
  }

  private extractLocaleFromPath(pathname: string): string | null {
    const match = pathname.match(LOCALE_REGEX);
    if (match) {
      return match[0].replace(/^\//, "");
    }
    return null;
  }

  private createHtmlHeaders(): Record<string, string> {
    return {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
    };
  }

  private createJsonHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
    };
  }
}

export function createRipplingScraper(
  httpClient: IHttpClient,
  config?: Partial<RipplingConfig>
): RipplingScraper {
  return new RipplingScraper(httpClient, config);
}
