import { z } from "zod";

import { containsHtml, processDescription } from "@/lib/jobs/description-processor";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import {
  createScraperError,
  parseExternalItems,
  parseExternalPayload,
  type ApiScraperConfig,
  type ScrapedJob,
  type ScrapeOptions,
  type ScraperResult,
  type SeniorityLevel,
} from "@/lib/scraper/types";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import { hydrateDetailsInBatches } from "./shared/detail-hydrator";
import {
  isDetailFailuresTolerable,
  resolveListingCompleteness,
} from "./shared/completeness";
import { selectListingsForHydration } from "./shared/listing-selection";

const NullableStringSchema = z.string().nullable().optional();
const UberLocationSchema = z
  .object({
    LocationName: NullableStringSchema,
  })
  .passthrough();
const UberListingSchema = z
  .object({
    Id: z.union([z.string(), z.number()]).transform(String),
    Title: z.string().min(1),
    PrimaryLocation: NullableStringSchema,
    PrimaryLocationCountry: NullableStringSchema,
    PostedDate: NullableStringSchema,
    WorkplaceType: NullableStringSchema,
    Category: NullableStringSchema,
    Department: NullableStringSchema,
    Organization: NullableStringSchema,
    otherWorkLocations: z.array(UberLocationSchema).optional(),
    secondaryLocations: z.array(UberLocationSchema).optional(),
  })
  .passthrough();
const UberListingPayloadSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            Limit: z.number().int().positive(),
            Offset: z.number().int().nonnegative(),
            TotalJobsCount: z.number().int().nonnegative(),
            requisitionList: z.array(z.unknown()),
          })
          .passthrough()
      )
      .min(1),
  })
  .passthrough();
const UberDetailSchema = z
  .object({
    Id: z.union([z.string(), z.number()]).transform(String),
    Title: z.string().min(1),
    PrimaryLocation: NullableStringSchema,
    ExternalDescriptionStr: NullableStringSchema,
    ExternalResponsibilitiesStr: NullableStringSchema,
    ExternalQualificationsStr: NullableStringSchema,
    ShortDescriptionStr: NullableStringSchema,
    Category: NullableStringSchema,
    Department: NullableStringSchema,
    Organization: NullableStringSchema,
    WorkplaceType: NullableStringSchema,
  })
  .passthrough();
const UberDetailPayloadSchema = z
  .object({
    items: z.array(UberDetailSchema),
  })
  .passthrough();

type UberListingRecord = z.infer<typeof UberListingSchema>;
type UberDetailRecord = z.infer<typeof UberDetailSchema>;

interface UberListingJob {
  id: string;
  title: string;
  url: string;
  location?: string;
  department?: string;
  postedDate?: Date;
  seniority?: SeniorityLevel;
}

interface UberHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

interface UberListingPageSuccess {
  ok: true;
  offset: number;
  totalJobs: number;
  listings: UberListingJob[];
  invalidListings: number;
}

interface UberListingPageFailure {
  ok: false;
  offset: number;
  status?: number;
  error?: unknown;
}

type UberListingPageResult = UberListingPageSuccess | UberListingPageFailure;

interface UberListingFetchResult {
  listings: UberListingJob[];
  advertisedTotal: number;
  failedOffsets: UberListingPageFailure[];
  invalidListings: number;
  truncatedByMaxPages: boolean;
  isComplete: boolean;
}

export type UberConfig = ApiScraperConfig & {
  apiBaseUrl: string;
  siteNumber: string;
  listingPageSize: number;
  maxListingPages: number;
  detailBatchSize: number;
  detailDelayMs: number;
};

const DEFAULT_UBER_CONFIG: UberConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://jobs.uber.com",
  apiBaseUrl: "https://iaziqy.fa.ocs.oraclecloud.com",
  siteNumber: "CX_1",
  listingPageSize: 200,
  maxListingPages: 10,
  detailBatchSize: 4,
  detailDelayMs: 400,
};

export class UberScraper extends AbstractApiScraper<UberConfig> {
  readonly platform = "uber" as const;

  constructor(httpClient: IHttpClient, config: Partial<UberConfig> = {}) {
    super(httpClient, { ...DEFAULT_UBER_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return (
      urlLower.includes("uber.com/careers") ||
      urlLower.includes("jobs.uber.com") ||
      (urlLower.includes("uber.com") && urlLower.includes("career"))
    );
  }

  extractIdentifier(url: string): string | null {
    void url;
    return "global";
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      if (!this.parseSourceUrl(url)) {
        return this.failure("invalid_url", "Invalid Uber Careers URL.");
      }

      const listingResult = await this.fetchAllListings();
      if (listingResult.listings.length === 0) {
        const firstFailure = listingResult.failedOffsets[0];
        if (firstFailure?.status) {
          return this.failureForHttpStatus(
            firstFailure.status,
            "Failed to fetch Uber jobs from the official careers API."
          );
        }
        if (firstFailure?.error) {
          return this.failureFromUnknown(firstFailure.error);
        }
        if (listingResult.advertisedTotal === 0 && listingResult.isComplete) {
          return {
            outcome: "success",
            jobs: [],
            totalListings: 0,
            openExternalIds: [],
            listingCompleteness: "complete",
          };
        }
        return this.failure(
          "parse_error",
          "Uber careers API returned no usable job listings."
        );
      }

      const listings = this.dedupeListings(listingResult.listings);
      const openExternalIds = listings.map((listing) =>
        this.generateExternalId(this.platform, listing.id)
      );
      const selection = selectListingsForHydration({
        listings,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (listing) => ({
          title: listing.title,
          location: listing.location,
        }),
        getExternalId: (listing) =>
          this.generateExternalId(this.platform, listing.id),
      });

      if (selection.listings.length === 0) {
        return {
          outcome: listingResult.isComplete ? "success" : "partial",
          jobs: [],
          totalListings: listings.length,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingCompleteness: listingResult.isComplete ? "complete" : "partial",
          issues: listingResult.isComplete
            ? undefined
            : [this.createListingIssue(listingResult, listings.length)],
        };
      }

      const hydrated = await hydrateDetailsInBatches<
        UberListingJob,
        UberHydratedJob
      >({
        items: selection.listings,
        initialBatchSize: this.config.detailBatchSize,
        initialDelayMs: this.config.detailDelayMs,
        fetcher: async (listing) => this.fetchAndHydrateJob(listing),
      });
      let detailFailures = hydrated.failures;
      const jobs = hydrated.results.map((result) => {
        if (result.failed) detailFailures++;
        return result.job;
      });
      const isPartial =
        !listingResult.isComplete ||
        !isDetailFailuresTolerable(detailFailures, selection.listings.length);
      const issues = [];
      if (!listingResult.isComplete) {
        issues.push(this.createListingIssue(listingResult, listings.length));
      }
      if (detailFailures > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${detailFailures} Uber job detail request${detailFailures === 1 ? "" : "s"} could not be hydrated; listing data was retained.`
          )
        );
      }

      return {
        outcome: isPartial ? "partial" : "success",
        jobs,
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

  private async fetchAllListings(): Promise<UberListingFetchResult> {
    const firstPage = await this.fetchListingPage(0);
    if (!firstPage.ok) {
      return {
        listings: [],
        advertisedTotal: 0,
        failedOffsets: [firstPage],
        invalidListings: 0,
        truncatedByMaxPages: false,
        isComplete: false,
      };
    }

    const requiredPages = Math.ceil(
      firstPage.totalJobs / this.config.listingPageSize
    );
    const pageCount = Math.min(requiredPages, this.config.maxListingPages);
    const offsets = Array.from(
      { length: Math.max(0, pageCount - 1) },
      (_value, index) => (index + 1) * this.config.listingPageSize
    );
    const remainingPages = await Promise.all(
      offsets.map((offset) => this.fetchListingPage(offset))
    );
    const successfulPages = [
      firstPage,
      ...remainingPages.filter(
        (page): page is UberListingPageSuccess => page.ok
      ),
    ];
    const failedOffsets = remainingPages.filter(
      (page): page is UberListingPageFailure => !page.ok
    );
    const advertisedTotal = Math.max(
      ...successfulPages.map((page) => page.totalJobs)
    );
    const listings = successfulPages.flatMap((page) => page.listings);
    const invalidListings = successfulPages.reduce(
      (total, page) => total + page.invalidListings,
      0
    );
    const truncatedByMaxPages = requiredPages > this.config.maxListingPages;
    const uniqueListingCount = this.dedupeListings(listings).length;
    // Invalid listings are already excluded from `listings`, so they count
    // toward the tolerated gap instead of failing the board alone.
    const { isComplete: countsComplete } = resolveListingCompleteness(
      uniqueListingCount,
      advertisedTotal
    );
    const isComplete =
      failedOffsets.length === 0 &&
      !truncatedByMaxPages &&
      countsComplete;

    return {
      listings,
      advertisedTotal,
      failedOffsets,
      invalidListings,
      truncatedByMaxPages,
      isComplete,
    };
  }

  private async fetchListingPage(offset: number): Promise<UberListingPageResult> {
    try {
      const response = await this.fetchResponse(this.createListingApiUrl(offset), {
        headers: this.jsonRequestHeaders(),
      });
      if (!response.ok) {
        return { ok: false, offset, status: response.status };
      }

      const payload = parseExternalPayload(
        UberListingPayloadSchema,
        await response.json(),
        `Uber listings at offset ${offset}`
      );
      const page = payload.items[0];
      if (!page) {
        return {
          ok: false,
          offset,
          error: new TypeError("Uber careers API returned no listing page."),
        };
      }
      const parsedListings = parseExternalItems(
        UberListingSchema,
        page.requisitionList,
        `Uber listings at offset ${offset}`
      );

      return {
        ok: true,
        offset,
        totalJobs: page.TotalJobsCount,
        listings: parsedListings.items.map((listing) =>
          this.mapOracleListing(listing)
        ),
        invalidListings: parsedListings.invalidCount,
      };
    } catch (error) {
      throwIfScrapeAborted(error);
      return { ok: false, offset, error };
    }
  }

  private createListingApiUrl(offset: number): string {
    const endpoint = new URL(
      "/hcmRestApi/resources/latest/recruitingCEJobRequisitions",
      this.config.apiBaseUrl
    );
    endpoint.searchParams.set("onlyData", "true");
    endpoint.searchParams.set(
      "expand",
      "requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations"
    );
    endpoint.searchParams.set(
      "finder",
      `findReqs;${[
        `siteNumber=${this.config.siteNumber}`,
        "facetsList=WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS;LOCATIONS",
        `limit=${this.config.listingPageSize}`,
        `offset=${offset}`,
        "sortBy=POSTING_DATES_DESC",
      ].join(",")}`
    );
    return endpoint.toString();
  }

  private mapOracleListing(listing: UberListingRecord): UberListingJob {
    return {
      id: listing.Id,
      title: listing.Title.trim(),
      url: new URL(`/en/jobs/${listing.Id}/`, this.config.baseUrl).toString(),
      location: listing.PrimaryLocation ?? undefined,
      department:
        listing.Category ?? listing.Department ?? listing.Organization ?? undefined,
      postedDate: this.parseDate(listing.PostedDate),
      seniority: this.mapSeniority(listing.Title),
    };
  }

  private dedupeListings(listings: UberListingJob[]): UberListingJob[] {
    return Array.from(
      new Map(listings.map((listing) => [listing.id, listing])).values()
    );
  }

  private async fetchAndHydrateJob(
    listing: UberListingJob
  ): Promise<UberHydratedJob> {
    const fallback = this.mapListingToJob(listing);

    try {
      const response = await this.fetchResponse(this.createDetailApiUrl(listing.id), {
        headers: this.jsonRequestHeaders(),
      });
      if (!response.ok) return { job: fallback, failed: true };

      const payload = parseExternalPayload(
        UberDetailPayloadSchema,
        await response.json(),
        `Uber job detail ${listing.id}`
      );
      const detail = payload.items[0];
      if (!detail) return { job: fallback, failed: true };

      return { job: this.mapDetailToJob(listing, detail), failed: false };
    } catch (error) {
      throwIfScrapeAborted(error);
      return { job: fallback, failed: true };
    }
  }

  private createDetailApiUrl(id: string): string {
    const endpoint = new URL(
      "/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails",
      this.config.apiBaseUrl
    );
    endpoint.searchParams.set("onlyData", "true");
    endpoint.searchParams.set("expand", "all");
    endpoint.searchParams.set(
      "finder",
      `ById;Id="${id}",siteNumber=${this.config.siteNumber}`
    );
    return endpoint.toString();
  }

  private mapDetailToJob(
    listing: UberListingJob,
    detail: UberDetailRecord
  ): ScrapedJob {
    const fallback = this.mapListingToJob(listing);
    const rawDescription = this.extractDescription(detail);
    const processed = rawDescription
      ? processDescription(
          rawDescription,
          containsHtml(rawDescription) ? "html" : "plain"
        )
      : null;
    const normalizedLocation = this.normalizeLocation(
      detail.PrimaryLocation ?? listing.location ?? ""
    );

    return {
      ...fallback,
      title: detail.Title.trim() || fallback.title,
      location: normalizedLocation.location,
      locationType: normalizedLocation.locationType,
      department:
        detail.Category ??
        detail.Department ??
        detail.Organization ??
        fallback.department,
      description: processed?.text ?? fallback.description,
      descriptionFormat: processed?.format ?? fallback.descriptionFormat,
    };
  }

  private mapListingToJob(listing: UberListingJob): ScrapedJob {
    const normalizedLocation = this.normalizeLocation(listing.location ?? "");
    return {
      externalId: this.generateExternalId(this.platform, listing.id),
      title: listing.title,
      url: listing.url,
      location: normalizedLocation.location,
      locationType: normalizedLocation.locationType,
      department: listing.department,
      postedDate: listing.postedDate,
      seniorityLevel: listing.seniority,
    };
  }

  private extractDescription(detail: UberDetailRecord): string {
    if (detail.ExternalDescriptionStr?.trim()) {
      return detail.ExternalDescriptionStr;
    }

    return [
      detail.ShortDescriptionStr,
      detail.ExternalResponsibilitiesStr,
      detail.ExternalQualificationsStr,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n\n");
  }

  private parseDate(value?: string | null): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private mapSeniority(title: string): SeniorityLevel | undefined {
    const lower = title.toLowerCase();
    if (/\b(?:intern|graduate|junior|jr\.?|i)\b/.test(lower)) return "entry";
    if (/\b(?:staff|principal|lead)\b/.test(lower)) return "lead";
    if (/\b(?:manager|director)\b/.test(lower)) return "manager";
    if (/\b(?:senior|sr\.?)\b/.test(lower)) return "senior";
    if (/\bii\b/.test(lower)) return "mid";
    return undefined;
  }

  private createListingIssue(result: UberListingFetchResult, fetched: number) {
    const details = [
      result.failedOffsets.length > 0
        ? `failed offsets: ${result.failedOffsets
            .map((failure) =>
              failure.status ? `${failure.offset} (HTTP ${failure.status})` : failure.offset
            )
            .join(", ")}`
        : null,
      result.invalidListings > 0
        ? `${result.invalidListings} invalid listing${result.invalidListings === 1 ? "" : "s"}`
        : null,
      result.truncatedByMaxPages
        ? `truncated at ${this.config.maxListingPages} pages`
        : null,
      fetched < result.advertisedTotal
        ? `received ${fetched} of ${result.advertisedTotal} advertised jobs`
        : null,
    ].filter((detail): detail is string => detail !== null);

    return createScraperError(
      "network_error",
      `Uber listings were only partially fetched (${details.join("; ") || "unknown API pagination failure"}).`
    );
  }
}
