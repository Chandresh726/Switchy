import { load } from "cheerio";
import { z } from "zod";

import { matchesPreferredCountry } from "@/lib/scraper/services/filter-service";
import {
  containsHtml,
  processDescription,
} from "@/lib/jobs/description-processor";
import { HttpError, type IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import {
  createScraperError,
  parseEmploymentType,
  parseExternalPayload,
  parseExternalItems,
  type ApiScraperConfig,
  type EmploymentType,
  type ScraperError,
  type ScrapeOptions,
  type ScrapedJob,
  type ScraperResult,
} from "@/lib/scraper/types";

import type { ListingQueryOptimizer } from "./shared/query-optimizer";
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
          hits: z.array(z.unknown()),
          page: z.number().int().nonnegative(),
          nbPages: z.number().int().nonnegative(),
          nbHits: z.number().int().nonnegative().optional(),
          facets: z.record(z.string(), z.record(z.string(), z.number())).optional().catch(undefined),
          exhaustiveFacetsCount: z.boolean().optional(),
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

const DEFAULT_RIPPLING_CONFIG: RipplingConfig = {
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

  constructor(httpClient: IHttpClient, config: Partial<RipplingConfig> = {}, private readonly queries?: ListingQueryOptimizer) {
    super(httpClient, { ...DEFAULT_RIPPLING_CONFIG, ...config });
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
      const requestedSize = this.queries?.policy(this.platform, url, this.config.algoliaIndexName).pageSize ?? this.config.listingPageSize;
      const pageSize = Number.isFinite(requestedSize) ? Math.min(1000, Math.max(1, Math.floor(requestedSize))) : 1000;
      const country = options?.filters?.country;
      const baseline = async () => {
        const value = await this.fetchAndGroupListings(undefined, pageSize);
        return { value, items: value.listings, complete: value.isComplete, advertisedTotal: value.isComplete ? value.listings.length : undefined };
      };
      const chosen = this.queries && country && !sourceUrl.search ? await this.queries.fetch({
        platform: this.platform, source: url, board: this.config.algoliaIndexName, country,
        minimumItems: pageSize + 1, candidateKey: { index: this.config.algoliaIndexName, pageSize, version: 1 }, baseline,
        candidate: async (previous) => {
          const facets = previous?.value.locationFacets ?? await this.fetchLocationFacets();
          const labels = facets.filter((label) => matchesPreferredCountry(label, country));
          if (!labels.length) return null;
          const value = await this.fetchAndGroupListings(labels, pageSize);
          return { value, items: value.listings, complete: value.isComplete, advertisedTotal: value.isComplete ? value.listings.length : undefined };
        },
        getId: (job) => job.id, toFilterable: (job) => job,
      }) : { value: (await baseline()).value, listingScopeKey: undefined };
      const listingResult = chosen.value;
      const listingScopeKey = chosen.listingScopeKey;
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
          listingScopeKey,
          listingCompleteness: listingResult.isComplete ? "complete" : "partial",
          issues: listingResult.isComplete
            ? undefined
            : [createScraperError("network_error", "Rippling listings were only partially fetched.")],
        };
      }

      const filters = options?.filters;
      const listingJobs: ScrapedJob[] = listings.map((item) => ({ externalId: this.generateExternalId(this.platform, item.id), title: item.title, url: item.url, location: item.location, locationType: item.locationType, department: item.department }));
      const selection = selectListingsForHydration({
        listings,
        filters,
        existingExternalIds: options?.existingExternalIds,
        detailRefresh: options?.detailRefresh,
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
          listingJobs,
          totalListings: listings.length,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingScopeKey,
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

      const issues: ScraperError[] = [...hydrated.issues];
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
        listingJobs,
        totalListings: listings.length,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds,
        listingScopeKey,
        listingCompleteness: listingResult.isComplete ? "complete" : "partial",
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private async fetchLocationFacets(): Promise<string[]> {
    const payload = await this.post<unknown>(
      `https://${this.config.algoliaAppId}-dsn.algolia.net/1/indexes/*/queries`,
      { requests: [{ indexName: this.config.algoliaIndexName, params: new URLSearchParams({
        hitsPerPage: "0", facets: JSON.stringify(["locationNames"]), maxValuesPerFacet: "1000",
      }).toString() }] },
      { headers: this.jsonRequestHeaders({ "x-algolia-application-id": this.config.algoliaAppId, "x-algolia-api-key": this.config.algoliaApiKey }) }
    );
    const result = parseExternalPayload(RipplingAlgoliaResponseSchema, payload, "Rippling location facets").results[0];
    return result?.exhaustiveFacetsCount === false ? [] : Object.keys(result?.facets?.locationNames ?? {});
  }

  private async fetchAndGroupListings(labels?: string[], pageSize = this.config.listingPageSize) {
    const entries: RipplingJobEntry[] = [];
    let page = 0;
    let totalPages = 1;
    let isComplete = true;
    let advertised: number | undefined;
    let locationFacets: string[] = [];
    const records = new Set<string>();
    const fingerprints = new Set<string>();

    while (page < totalPages) {
      try {
        const data = await this.post<unknown>(
          `https://${this.config.algoliaAppId}-dsn.algolia.net/1/indexes/*/queries`,
          {
            requests: [
              {
                indexName: this.config.algoliaIndexName,
                params: new URLSearchParams({
                  hitsPerPage: String(pageSize), page: String(page),
                  ...(this.queries ? { facets: JSON.stringify(["locationNames"]), maxValuesPerFacet: "1000" } : {}),
                  ...(labels ? { facetFilters: JSON.stringify([labels.map((label) => `locationNames:${label}`)]) } : {}),
                }).toString(),
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
        totalPages = Math.min(result.nbPages, 100);
        if (result.nbPages > 100) isComplete = false;
        if (advertised !== undefined && result.nbHits !== undefined && advertised !== result.nbHits) isComplete = false;
        advertised ??= result.nbHits;
        if (page === 0 && result.exhaustiveFacetsCount !== false) locationFacets = Object.keys(result.facets?.locationNames ?? {});
        const hits = parseExternalItems(RipplingAlgoliaHitSchema, result.hits, "Rippling hits");
        if (hits.invalidCount > 0) isComplete = false;
        const fingerprint = JSON.stringify(hits.items.map((hit) => [hit.jobId, hit.locations]).sort());
        if (hits.items.length && fingerprints.has(fingerprint)) { isComplete = false; break; }
        fingerprints.add(fingerprint);
        for (const hit of hits.items) records.add(typeof hit.objectID === "string" ? hit.objectID : JSON.stringify([hit.jobId, hit.locations]));
        entries.push(
          ...hits.items.map((hit) => ({
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
        if (error instanceof HttpError && (error.status === 429 || error.isBrowserChallenge)) throw error;
        if (page === 0) throw error;
        isComplete = false;
        break;
      }
    }

    return {
      listings: this.groupAndMergeLocations(entries),
      locationFacets,
      isComplete: isComplete && advertised !== undefined && records.size >= advertised,
    };
  }

  private groupAndMergeLocations(
    entries: RipplingJobEntry[]
  ): RipplingListingJob[] {
    const grouped = new Map<string, RipplingListingJob>();

    for (const entry of entries) {
      const existing = grouped.get(entry.id);

      const location = entry.locations?.[0];
      const locationName = [...new Set(entry.locations?.map((item) => item.name) ?? [])].join(" | ");
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
