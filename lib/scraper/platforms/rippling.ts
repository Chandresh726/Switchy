import { load } from "cheerio";
import { z } from "zod";

import {
  containsHtml,
  processDescription,
} from "@/lib/jobs/description-processor";
import {
  HttpError,
  type IHttpClient,
} from "@/lib/scraper/infrastructure/http-client";
import {
  parseEmploymentType,
  parseExternalPayload,
  type ApiScraperConfig,
  type EmploymentType,
  type ScrapeOptions,
  type ScrapedJob,
  type ScraperResult,
} from "@/lib/scraper/types";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import { hydrateDetailsInBatches } from "./shared/detail-hydrator";
import { selectListingsForHydration } from "./shared/listing-selection";

interface RipplingLocation {
  name: string;
  workplaceType: "ON_SITE" | "REMOTE" | "HYBRID";
}

interface RipplingJobEntry {
  id: string;
  name: string;
  url: string;
  department?: { name: string };
  locations?: RipplingLocation[];
}

interface RipplingJobsResponse {
  pageProps: {
    jobs: {
      items: RipplingJobEntry[];
    };
  };
}

const RipplingJobsResponseSchema = z
  .object({
    pageProps: z
      .object({
        jobs: z
          .object({
            items: z.array(
              z
                .object({
                  id: z.string(),
                  name: z.string(),
                  url: z.string(),
                  department: z.object({ name: z.string() }).passthrough().optional(),
                  locations: z.array(
                    z
                      .object({
                        name: z.string(),
                        workplaceType: z.enum(["ON_SITE", "REMOTE", "HYBRID"]),
                      })
                      .passthrough()
                  ).optional(),
                })
                .passthrough()
            ),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

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
      const sourceUrl = this.parseSourceUrl(url);
      if (!sourceUrl) {
        return this.failure("invalid_url", "Invalid Rippling Careers URL.");
      }
      const locale = this.extractLocaleFromPath(sourceUrl.pathname) || "en-IN";

      const buildId = await this.fetchBuildId();
      if (!buildId) {
        return this.failure("parse_error", "Failed to extract Rippling build ID.");
      }

      const listings = await this.fetchAndGroupListings(buildId, locale);
      const openExternalIds = listings.map((job) =>
        this.generateExternalId(this.platform, job.id)
      );

      if (listings.length === 0) {
        return {
          outcome: "success",
          jobs: [],
          totalListings: 0,
          openExternalIds,
          listingCompleteness: "complete",
        };
      }

      const filters = options?.filters;
      const selection = selectListingsForHydration({
        listings,
        filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (listing) => ({
          title: listing.title,
          location: listing.location,
        }),
        getExternalId: (listing) =>
          this.generateExternalId(this.platform, listing.id),
      });
      const jobsToFetch = selection.listings;

      if (jobsToFetch.length === 0) {
        return {
          outcome: "success",
          jobs: [],
          totalListings: listings.length,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingCompleteness: "complete",
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
        outcome: detailFailures > 0 ? "partial" : "success",
        jobs: scrapedJobs,
        totalListings: listings.length,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds,
        listingCompleteness: "complete",
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private async fetchBuildId(): Promise<string | null> {
    const response = await this.fetchResponse(this.config.baseUrl, {
      headers: this.htmlRequestHeaders(),
    });

    if (!response.ok) {
      throw new HttpError(
        response.status,
        `Failed to fetch Rippling build metadata: HTTP ${response.status}`,
        this.config.baseUrl
      );
    }

    const html = await response.text();
    const match = html.match(BUILD_ID_REGEX);
    return match ? match[1] : null;
  }

  private async fetchAndGroupListings(
    buildId: string,
    locale: string
  ): Promise<RipplingListingJob[]> {
    const dataUrl = `${this.config.baseUrl}/_next/data/${buildId}/${locale}/careers/open-roles.json`;
    const response = await this.fetchResponse(dataUrl, {
      headers: this.jsonRequestHeaders(),
    });

    if (!response.ok) {
      throw new HttpError(
        response.status,
        `Failed to fetch Rippling jobs: HTTP ${response.status}`,
        dataUrl
      );
    }

    const data: RipplingJobsResponse = parseExternalPayload(
      RipplingJobsResponseSchema,
      await response.json(),
      "Rippling"
    );
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

    const response = await this.fetchResponse(listing.url, {
      headers: this.htmlRequestHeaders(),
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

    const processed = processDescription(
      cleaned,
      containsHtml(cleaned) ? "html" : "plain"
    );
    return {
      description: processed.text ?? undefined,
      descriptionFormat: processed.format,
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
}
