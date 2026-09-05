import { z } from "zod";

import {
  containsHtml,
  processDescription,
} from "@/lib/jobs/description-processor";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import {
  createScraperError,
  parseEmploymentType,
  parseExternalItems,
  parseExternalPayload,
} from "@/lib/scraper/types";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type {
  ApiScraperConfig,
  ScrapedJob,
  ScrapeOptions,
  ScraperResult,
} from "../core/types";
import { hydrateDetailsInBatches } from "./shared/detail-hydrator";
import {
  isDetailFailuresTolerable,
  resolveListingCompleteness,
} from "./shared/completeness";
import { selectListingsForHydration } from "./shared/listing-selection";

const NullableStringSchema = z.string().nullable().optional();

interface PhenomLocationPayload {
  location?: string | null;
  locationName?: string | null;
  cityStateCountry?: string | null;
  cityCountry?: string | null;
  mapQueryLocation?: string | null;
}

type PhenomLocation = string | PhenomLocationPayload;

const PhenomLocationSchema: z.ZodType<PhenomLocation> = z.union([
  z.string(),
  z
    .object({
      location: NullableStringSchema,
      locationName: NullableStringSchema,
      cityStateCountry: NullableStringSchema,
      cityCountry: NullableStringSchema,
      mapQueryLocation: NullableStringSchema,
    })
    .passthrough(),
]);

const PhenomStructuredDataSchema = z
  .object({
    title: NullableStringSchema,
    description: NullableStringSchema,
    datePosted: NullableStringSchema,
    employmentType: NullableStringSchema,
    occupationalCategory: NullableStringSchema,
  })
  .passthrough()
  .optional();

interface PhenomListingPayload {
  reqId: string;
  title: string;
  jobUrl?: string;
  location?: string | null;
  category?: string | null;
  type?: string | null;
  postedDate?: string | null;
  descriptionTeaser?: string | null;
  remote?: string | null;
  RemoteType?: string | null;
  multi_location?: PhenomLocation[];
}

const PhenomListingSchema: z.ZodType<PhenomListingPayload> = z
  .object({
    reqId: z.string().min(1),
    title: z.string().min(1),
    jobUrl: z.string().url().optional(),
    location: NullableStringSchema,
    category: NullableStringSchema,
    type: NullableStringSchema,
    postedDate: NullableStringSchema,
    descriptionTeaser: NullableStringSchema,
    remote: NullableStringSchema,
    RemoteType: NullableStringSchema,
    multi_location: z.array(PhenomLocationSchema).optional(),
  })
  .passthrough();
const PhenomDdoSchema = z
  .object({
    siteConfig: z
      .object({
        data: z.object({ refNum: z.string().min(1) }).passthrough(),
      })
      .passthrough(),
    eagerLoadRefineSearch: z
      .object({
        hits: z.number().int().nonnegative(),
        totalHits: z.number().int().nonnegative(),
        data: z.object({ jobs: z.array(z.unknown()) }).passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
const PhenomDetailSchema = z
  .object({
    reqId: z.string().min(1),
    title: NullableStringSchema,
    description: NullableStringSchema,
    location: NullableStringSchema,
    category: NullableStringSchema,
    type: NullableStringSchema,
    postedDate: NullableStringSchema,
    remote: NullableStringSchema,
    RemoteType: NullableStringSchema,
    multi_location: z.array(PhenomLocationSchema).optional(),
    locationName: NullableStringSchema,
    structureData: PhenomStructuredDataSchema,
  })
  .passthrough();
const PhenomDetailDdoSchema = z
  .object({
    jobDetail: z.object({
      data: z.object({ job: PhenomDetailSchema }).passthrough(),
    }),
  })
  .passthrough();

interface PhenomListing extends Omit<PhenomListingPayload, "jobUrl"> {
  jobUrl: string;
}

interface PhenomHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

export type PhenomConfig = ApiScraperConfig & {
  maxListingPages: number;
  detailBatchSize: number;
  detailDelayMs: number;
};

const DEFAULT_PHENOM_CONFIG: PhenomConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://jobs.ebayinc.com/us/en/search-results",
  maxListingPages: 200,
  detailBatchSize: 5,
  detailDelayMs: 200,
};

export class PhenomScraper extends AbstractApiScraper<PhenomConfig> {
  readonly platform = "phenom" as const;

  constructor(httpClient: IHttpClient, config: Partial<PhenomConfig> = {}) {
    super(httpClient, { ...DEFAULT_PHENOM_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const parsed = this.parseSourceUrl(url);
    const hostname = parsed?.hostname.toLowerCase();
    return hostname === "jobs.ebayinc.com" || hostname === "careers.cisco.com";
  }

  extractIdentifier(url: string): string | null {
    const parsed = this.parseSourceUrl(url);
    if (!parsed) return null;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "jobs.ebayinc.com") return "EBAEBAUS";
    if (hostname === "careers.cisco.com") return "CISCISGLOBAL";
    return null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const source = this.parseSourceUrl(url);
      if (!source) return this.failure("invalid_url", "Invalid Phenom careers URL.");
      const searchUrl = this.createSearchUrl(source);
      const first = await this.fetchPage(searchUrl.toString(), 0);
      if (!first.ok) {
        if (first.status) {
          return this.failureForHttpStatus(first.status, "Failed to fetch Phenom jobs.");
        }
        return this.failureFromUnknown(first.error);
      }

      const refNum = options?.boardToken?.trim() || first.refNum;
      if (!refNum) {
        return this.failure("parse_error", "Phenom page did not expose a refNum.");
      }
      const pageSize = Math.max(1, first.hits || first.listings.length || 10);
      const requiredPages = Math.ceil(first.totalHits / pageSize);
      const pageCount = Math.min(requiredPages, this.config.maxListingPages);
      const listings = new Map<string, PhenomListing>();
      for (const listing of first.listings) listings.set(listing.reqId, listing);
      const failedOffsets: number[] = [];

      const pageResults = await Promise.all(
        Array.from({ length: Math.max(0, pageCount - 1) }, async (_value, index) => {
          const page = index + 1;
          const offset = page * pageSize;
          const pageUrl = new URL(searchUrl);
          pageUrl.searchParams.set("from", String(offset));
          pageUrl.searchParams.set("s", "1");
          return {
            offset,
            result: await this.fetchPage(
              pageUrl.toString(),
              offset,
              first.sessionCookie
            ),
          };
        })
      );
      for (const { offset, result } of pageResults) {
        if (!result.ok) {
          failedOffsets.push(offset);
          continue;
        }
        for (const listing of result.listings) listings.set(listing.reqId, listing);
      }

      const allListings = Array.from(listings.values());
      // Invalid listings are already excluded from `allListings`, so they
      // count toward the tolerated gap instead of failing the board alone.
      const { isComplete: countsComplete } = resolveListingCompleteness(
        allListings.length,
        first.totalHits
      );
      const listingComplete =
        failedOffsets.length === 0 &&
        requiredPages <= this.config.maxListingPages &&
        countsComplete;
      if (allListings.length === 0) {
        if (first.totalHits === 0 && listingComplete) {
          return {
            outcome: "success",
            jobs: [],
            totalListings: 0,
            openExternalIds: [],
            listingCompleteness: "complete",
            detectedBoardToken: options?.boardToken ? undefined : refNum,
          };
        }
        return this.failure("parse_error", "Phenom returned no usable job listings.");
      }

      const openExternalIds = allListings.map((listing) =>
        this.externalId(refNum, listing.reqId)
      );
      const selection = selectListingsForHydration({
        listings: allListings,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (listing) => ({
          title: listing.title,
          location: listing.location ?? undefined,
        }),
        getExternalId: (listing) => this.externalId(refNum, listing.reqId),
      });
      const hydrated = await hydrateDetailsInBatches<
        PhenomListing,
        PhenomHydratedJob
      >({
        items: selection.listings,
        initialBatchSize: this.config.detailBatchSize,
        initialDelayMs: this.config.detailDelayMs,
        fetcher: (listing) => this.fetchDetail(refNum, listing, first.sessionCookie),
      });
      let detailFailures = hydrated.failures;
      const jobs = hydrated.results.map((result) => {
        if (result.failed) detailFailures++;
        return result.job;
      });
      const issues = [];
      if (!listingComplete) {
        issues.push(
          createScraperError(
            "network_error",
            `Phenom listings were incomplete (${failedOffsets.length} failed offset${failedOffsets.length === 1 ? "" : "s"}, ${allListings.length} of ${first.totalHits} advertised jobs).`
          )
        );
      }
      if (detailFailures > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${detailFailures} Phenom detail request${detailFailures === 1 ? "" : "s"} could not be hydrated; listing data was retained.`
          )
        );
      }

      return {
        outcome:
          listingComplete &&
          isDetailFailuresTolerable(detailFailures, selection.listings.length)
            ? "success"
            : "partial",
        jobs,
        totalListings: allListings.length,
        openExternalIds,
        listingCompleteness: listingComplete ? "complete" : "partial",
        earlyFiltered: selection.earlyFiltered,
        detectedBoardToken: options?.boardToken ? undefined : refNum,
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private async fetchPage(url: string, offset: number, sessionCookie?: string): Promise<
    | {
        ok: true;
        refNum: string;
        hits: number;
        totalHits: number;
        listings: PhenomListing[];
        invalidListings: number;
        sessionCookie?: string;
      }
    | { ok: false; status?: number; error?: unknown }
  > {
    try {
      const response = await this.fetchResponse(url, {
        headers: this.htmlRequestHeaders(
          sessionCookie ? { Cookie: sessionCookie } : undefined
        ),
      });
      if (!response.ok) return { ok: false, status: response.status };
      const rawDdo = this.extractDdo(await response.text());
      const ddo = parseExternalPayload(
        PhenomDdoSchema,
        rawDdo,
        `Phenom listings at offset ${offset}`
      );
      const parsedListings = parseExternalItems(
        PhenomListingSchema,
        ddo.eagerLoadRefineSearch.data.jobs,
        `Phenom listings at offset ${offset}`
      );
      return {
        ok: true,
        refNum: ddo.siteConfig.data.refNum,
        hits: ddo.eagerLoadRefineSearch.hits,
        totalHits: ddo.eagerLoadRefineSearch.totalHits,
        listings: parsedListings.items.map((listing) => ({
          ...listing,
          location: this.collectLocations(
            listing.location,
            listing.multi_location
          ),
          jobUrl: listing.jobUrl ?? this.createJobUrl(url, listing),
        })),
        invalidListings: parsedListings.invalidCount,
        sessionCookie: sessionCookie ?? this.extractSessionCookie(response.headers),
      };
    } catch (error) {
      throwIfScrapeAborted(error);
      return { ok: false, error };
    }
  }

  private async fetchDetail(
    refNum: string,
    listing: PhenomListing,
    sessionCookie?: string
  ): Promise<PhenomHydratedJob> {
    const fallback = this.mapListingToJob(refNum, listing);
    try {
      const response = await this.fetchResponse(listing.jobUrl, {
        headers: this.htmlRequestHeaders(
          sessionCookie ? { Cookie: sessionCookie } : undefined
        ),
      });
      if (!response.ok) return { job: fallback, failed: true };
      const payload = parseExternalPayload(
        PhenomDetailDdoSchema,
        this.extractDdo(await response.text()),
        `Phenom job detail ${listing.reqId}`
      );
      const detail = payload.jobDetail.data.job;
      const description = detail.description ?? detail.structureData?.description;
      const processed = description
        ? processDescription(
            description,
            containsHtml(description) ? "html" : "plain"
          )
        : null;
      const normalizedLocation = this.normalizeLocation(
        this.collectLocations(
          detail.location ?? detail.locationName,
          detail.multi_location,
          listing.location
        ) ?? ""
      );
      const remoteType =
        detail.RemoteType ??
        detail.remote ??
        listing.RemoteType ??
        listing.remote;
      return {
        failed: !processed?.text,
        job: {
          ...fallback,
          title:
            detail.title?.trim() ??
            detail.structureData?.title?.trim() ??
            fallback.title,
          location: normalizedLocation.location,
          locationType: this.resolveLocationType(
            remoteType,
            normalizedLocation.locationType
          ),
          department:
            detail.category ??
            detail.structureData?.occupationalCategory ??
            listing.category ??
            undefined,
          employmentType: parseEmploymentType(
            detail.type ??
              detail.structureData?.employmentType ??
              listing.type ??
              undefined
          ),
          postedDate: this.parseDate(
            detail.postedDate ??
              detail.structureData?.datePosted ??
              listing.postedDate
          ),
          description: processed?.text ?? fallback.description,
          descriptionFormat: processed?.format ?? fallback.descriptionFormat,
        },
      };
    } catch (error) {
      throwIfScrapeAborted(error);
      return { job: fallback, failed: true };
    }
  }

  private mapListingToJob(refNum: string, listing: PhenomListing): ScrapedJob {
    const normalizedLocation = this.normalizeLocation(listing.location ?? "");
    const processed = listing.descriptionTeaser
      ? processDescription(listing.descriptionTeaser, "plain")
      : null;
    return {
      externalId: this.externalId(refNum, listing.reqId),
      title: listing.title.trim(),
      url: listing.jobUrl,
      location: normalizedLocation.location,
      locationType: this.resolveLocationType(
        listing.RemoteType ?? listing.remote,
        normalizedLocation.locationType
      ),
      department: listing.category ?? undefined,
      employmentType: parseEmploymentType(listing.type ?? undefined),
      postedDate: this.parseDate(listing.postedDate),
      description: processed?.text ?? undefined,
      descriptionFormat: processed?.format,
    };
  }

  private extractDdo(html: string): unknown {
    const marker = "phApp.ddo";
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) throw new TypeError("Phenom page did not contain phApp.ddo.");
    const objectStart = html.indexOf("{", markerIndex + marker.length);
    if (objectStart < 0) throw new TypeError("Phenom phApp.ddo did not contain an object.");

    const assignmentEnd = html.indexOf("; phApp.", objectStart);
    if (assignmentEnd > objectStart) {
      const candidate = html.slice(objectStart, assignmentEnd);
      try {
        return JSON.parse(candidate);
      } catch {
        const missingClosures = this.countMissingObjectClosures(candidate);
        if (missingClosures > 0 && missingClosures <= 2) {
          try {
            return JSON.parse(`${candidate}${"}".repeat(missingClosures)}`);
          } catch {
            // Fall through to balanced-object extraction below.
          }
        }
      }
    }

    let depth = 0;
    let quote: '"' | "'" | null = null;
    let escaped = false;
    for (let index = objectStart; index < html.length; index++) {
      const character = html[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === "{") depth++;
      if (character === "}") {
        depth--;
        if (depth === 0) {
          return JSON.parse(html.slice(objectStart, index + 1));
        }
      }
    }
    throw new TypeError("Phenom phApp.ddo object was incomplete.");
  }

  private extractSessionCookie(headers: Headers): string | undefined {
    const headersWithSetCookie = headers as Headers & {
      getSetCookie?: () => string[];
    };
    const combined = headers.get("set-cookie");
    const setCookieValues = headersWithSetCookie.getSetCookie?.() ??
      (combined ? combined.split(/,(?=\s*[A-Za-z0-9_-]+=)/gu) : []);
    const allowedNames = new Set([
      "PLAY_SESSION",
      "PHPPPE_ACT",
      "VISITED_LANG",
      "VISITED_COUNTRY",
    ]);
    const values = setCookieValues
      .map((value) => value.split(";", 1)[0]?.trim())
      .filter((value): value is string => {
        if (!value) return false;
        const separator = value.indexOf("=");
        return separator > 0 && allowedNames.has(value.slice(0, separator));
      });
    return values.length > 0 ? values.join("; ") : undefined;
  }

  private externalId(refNum: string, reqId: string): string {
    return this.generateExternalId(this.platform, refNum, reqId);
  }

  private createSearchUrl(source: URL): URL {
    const pathname = source.pathname.replace(/\/+$/u, "");
    const isSearchRoute = /\/(?:search-results|search-page)$/iu.test(pathname);
    const defaultPath = source.hostname.toLowerCase() === "careers.cisco.com"
      ? "/global/en/search-results"
      : "/us/en/search-results";
    return new URL(isSearchRoute ? pathname : defaultPath, source.origin);
  }

  private createJobUrl(pageUrl: string, listing: PhenomListingPayload): string {
    const parsed = new URL(pageUrl);
    const basePath = parsed.pathname
      .replace(/\/splunk\/search-page.*$/iu, "")
      .replace(/\/(?:search-results|search-page).*$/iu, "")
      .replace(/\/$/u, "");
    const slug = listing.title
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/giu, "-")
      .replace(/^-|-$/gu, "");
    return new URL(
      `${basePath}/job/${encodeURIComponent(listing.reqId)}/${slug}`,
      parsed.origin
    ).toString();
  }

  private parseDate(value?: string | null): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private collectLocations(
    primary?: string | null,
    additional?: PhenomLocation[],
    fallback?: string | null
  ): string | undefined {
    const locations = [
      primary,
      ...(additional?.map((location) => this.getLocationName(location)) ?? []),
      ...(fallback?.split(/\s*\|\s*/u) ?? []),
    ];
    const uniqueLocations = new Map<string, string>();
    for (const location of locations) {
      const normalized = location?.replace(/\s+/gu, " ").trim();
      if (!normalized) continue;
      uniqueLocations.set(normalized.toLowerCase(), normalized);
    }
    return uniqueLocations.size > 0
      ? Array.from(uniqueLocations.values()).join(" | ")
      : undefined;
  }

  private getLocationName(location: PhenomLocation): string | null | undefined {
    if (typeof location === "string") return location;
    return (
      location.location ??
      location.locationName ??
      location.cityStateCountry ??
      location.cityCountry ??
      location.mapQueryLocation
    );
  }

  private countMissingObjectClosures(candidate: string): number {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (const character of candidate) {
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}") depth--;
    }
    return quoted ? 0 : depth;
  }

  private resolveLocationType(
    remoteType: string | null | undefined,
    fallback: ScrapedJob["locationType"]
  ): ScrapedJob["locationType"] {
    const normalized = remoteType?.toLowerCase() ?? "";
    if (normalized.includes("remote")) return "remote";
    if (normalized.includes("hybrid")) return "hybrid";
    return fallback;
  }
}
