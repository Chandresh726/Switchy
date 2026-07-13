import { load } from "cheerio";
import { z } from "zod";

import {
  containsHtml,
  processDescription,
} from "@/lib/jobs/description-processor";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import {
  createScraperError,
  parseEmploymentType,
  parseExternalPayload,
  type ApiScraperConfig,
  type EmploymentType,
  type ScraperError,
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

const RipplingAlgoliaHitSchema = z
  .object({
    jobId: z.string(),
    name: z.string(),
    url: z.string(),
    department: z
      .object({ name: z.string().nullish() })
      .passthrough()
      .nullish(),
    departmentName: z.string().nullish(),
    locations: z
      .array(
        z
          .object({
            name: z.string(),
            workplaceType: z.enum(["ON_SITE", "REMOTE", "HYBRID"]),
          })
          .passthrough()
      )
      .nullish(),
  })
  .passthrough();

const RipplingAlgoliaResponseSchema = z
  .object({
    results: z.array(
      z
        .object({
          hits: z.array(RipplingAlgoliaHitSchema),
          page: z.number().int().nonnegative(),
          nbPages: z.number().int().nonnegative(),
        })
        .passthrough()
    ),
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
  algoliaAppId: string;
  algoliaApiKey: string;
  algoliaIndexName: string;
  listingPageSize: number;
};

export const DEFAULT_RIPPLING_CONFIG: RipplingConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://www.rippling.com",
  detailBatchSize: 4,
  detailDelayMs: 500,
  algoliaAppId: "6FNAX3TBEF",
  algoliaApiKey: "416caa4690f002ff6fe4a2097623640b",
  algoliaIndexName: "careers_en-US_production",
  listingPageSize: 1_000,
};

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
      const listingResult = await this.fetchAndGroupListings();
      const { listings } = listingResult;
      const openExternalIds = listings.map((job) =>
        this.generateExternalId(this.platform, job.id)
      );

      if (listings.length === 0) {
        return {
          outcome: listingResult.isComplete ? "success" : "partial",
          jobs: [],
          totalListings: 0,
          openExternalIds,
          listingCompleteness: listingResult.isComplete ? "complete" : "partial",
          issues: listingResult.isComplete
            ? undefined
            : [createScraperError("network_error", "Rippling listings were only partially fetched.")],
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
          outcome: listingResult.isComplete ? "success" : "partial",
          jobs: [],
          totalListings: listings.length,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingCompleteness: listingResult.isComplete ? "complete" : "partial",
          issues: listingResult.isComplete
            ? undefined
            : [createScraperError("network_error", "Rippling listings were only partially fetched.")],
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

      const issues: ScraperError[] = [];
      if (!listingResult.isComplete) {
        issues.push(
          createScraperError(
            "network_error",
            "Rippling listings were only partially fetched."
          )
        );
      }
      if (detailFailures > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${detailFailures} Rippling job detail request${detailFailures === 1 ? "" : "s"} failed; listing data was retained.`
          )
        );
      }

      return {
        outcome: issues.length > 0 ? "partial" : "success",
        jobs: scrapedJobs,
        totalListings: listings.length,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds,
        listingCompleteness: listingResult.isComplete ? "complete" : "partial",
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private async fetchAndGroupListings(): Promise<{
    listings: RipplingListingJob[];
    isComplete: boolean;
  }> {
    const entries: RipplingJobEntry[] = [];
    let page = 0;
    let totalPages = 1;
    let isComplete = true;

    while (page < totalPages) {
      try {
        const data = await this.post<unknown>(
          `https://${this.config.algoliaAppId}-dsn.algolia.net/1/indexes/*/queries`,
          {
            requests: [
              {
                indexName: this.config.algoliaIndexName,
                params: `hitsPerPage=${this.config.listingPageSize}&page=${page}`,
              },
            ],
          },
          {
            headers: this.jsonRequestHeaders({
              "x-algolia-application-id": this.config.algoliaAppId,
              "x-algolia-api-key": this.config.algoliaApiKey,
            }),
          }
        );
        const parsed = parseExternalPayload(
          RipplingAlgoliaResponseSchema,
          data,
          "Rippling Algolia"
        );
        const result = parsed.results[0];
        if (!result) {
          throw new Error("Rippling Algolia returned no search result.");
        }
        totalPages = result.nbPages;
        entries.push(
          ...result.hits.map((hit) => ({
            id: hit.jobId,
            name: hit.name.trim(),
            url: hit.url,
            department: hit.department?.name
              ? { name: hit.department.name }
              : hit.departmentName
                ? { name: hit.departmentName }
                : undefined,
            locations: hit.locations ?? undefined,
          }))
        );
        page++;
      } catch (error) {
        throwIfScrapeAborted(error);
        if (page === 0) throw error;
        isComplete = false;
        break;
      }
    }

    return {
      listings: this.groupAndMergeLocations(entries),
      isComplete,
    };
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
