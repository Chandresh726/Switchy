import { z } from "zod";

import {
  containsHtml,
  processDescription,
} from "@/lib/jobs/description-processor";
import {
  abortableDelay,
  throwIfScrapeAborted,
} from "@/lib/scraper/infrastructure/cancellation";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import {
  createScraperError,
  parseEmploymentType,
  parseExternalItems,
  parseExternalPayload,
  type SeniorityLevel,
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
const OracleLocationSchema = z
  .object({ LocationName: NullableStringSchema })
  .passthrough();
const OracleListingSchema = z
  .object({
    Id: z.union([z.string(), z.number()]).transform(String),
    Title: z.string().min(1),
    PrimaryLocation: NullableStringSchema,
    PrimaryLocationCountry: NullableStringSchema,
    PostedDate: NullableStringSchema,
    WorkplaceType: NullableStringSchema,
    JobType: NullableStringSchema,
    JobFamily: NullableStringSchema,
    JobFunction: NullableStringSchema,
    Department: NullableStringSchema,
    Organization: NullableStringSchema,
    otherWorkLocations: z.array(OracleLocationSchema).optional(),
    secondaryLocations: z.array(OracleLocationSchema).optional(),
  })
  .passthrough();
const OracleListingPayloadSchema = z
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
const OracleDetailSchema = z
  .object({
    Id: z.union([z.string(), z.number()]).transform(String),
    Title: z.string().min(1),
    PrimaryLocation: NullableStringSchema,
    ExternalDescriptionStr: NullableStringSchema,
    ExternalResponsibilitiesStr: NullableStringSchema,
    ExternalQualificationsStr: NullableStringSchema,
    ShortDescriptionStr: NullableStringSchema,
    WorkplaceType: NullableStringSchema,
    JobType: NullableStringSchema,
    JobFamily: NullableStringSchema,
    JobFunction: NullableStringSchema,
    Department: NullableStringSchema,
    Organization: NullableStringSchema,
    otherWorkLocations: z.array(OracleLocationSchema).optional(),
    secondaryLocations: z.array(OracleLocationSchema).optional(),
  })
  .passthrough();
const OracleDetailPayloadSchema = z
  .object({ items: z.array(OracleDetailSchema) })
  .passthrough();

type OracleListingRecord = z.infer<typeof OracleListingSchema>;
type OracleDetailRecord = z.infer<typeof OracleDetailSchema>;

interface OracleBoard {
  origin: string;
  apiOrigin: string;
  hostname: string;
  siteNumber: string;
  siteAlias: string;
}

interface OracleListing {
  id: string;
  title: string;
  url: string;
  location?: string;
  department?: string;
  jobType?: string;
  workplaceType?: string;
  postedDate?: Date;
  seniority?: SeniorityLevel;
}

interface OracleHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

interface OraclePageSuccess {
  ok: true;
  offset: number;
  limit: number;
  totalJobs: number;
  listings: OracleListing[];
  invalidListings: number;
}

interface OraclePageFailure {
  ok: false;
  offset: number;
  status?: number;
  error?: unknown;
}

type OraclePageResult = OraclePageSuccess | OraclePageFailure;

export type OracleConfig = ApiScraperConfig & {
  listingPageSize: number;
  maxListingPages: number;
  detailBatchSize: number;
  detailDelayMs: number;
};

const DEFAULT_ORACLE_CONFIG: OracleConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://hdpc.fa.us2.oraclecloud.com",
  listingPageSize: 200,
  maxListingPages: 100,
  detailBatchSize: 5,
  detailDelayMs: 200,
};

const GOLDMAN_ORACLE_BOARD: OracleBoard = {
  origin: "https://hdpc.fa.us2.oraclecloud.com",
  apiOrigin: "https://hdpc.fa.us2.oraclecloud.com",
  hostname: "hdpc.fa.us2.oraclecloud.com",
  siteNumber: "CX_3002",
  siteAlias: "LateralHiring",
};

const ORACLE_BRANDED_SITE_NUMBERS = new Map([
  ["careers.oracle.com", "CX_45001"],
  ["careers.ti.com", "CX"],
]);
const ORACLE_BRANDED_HOSTS = new Set(ORACLE_BRANDED_SITE_NUMBERS.keys());

function isOracleCareersHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return (
    normalizedHostname.endsWith(".oraclecloud.com") ||
    ORACLE_BRANDED_HOSTS.has(normalizedHostname)
  );
}

export class OracleScraper extends AbstractApiScraper<OracleConfig> {
  readonly platform = "oracle" as const;

  constructor(httpClient: IHttpClient, config: Partial<OracleConfig> = {}) {
    super(httpClient, { ...DEFAULT_ORACLE_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const parsed = this.parseSourceUrl(url);
    if (!parsed) return false;
    const hostname = parsed.hostname.toLowerCase();
    return (
      (hostname.endsWith(".oraclecloud.com") &&
        parsed.pathname.toLowerCase().includes("/hcmui/candidateexperience/")) ||
      ORACLE_BRANDED_HOSTS.has(hostname) ||
      hostname === "higher.gs.com"
    );
  }

  extractIdentifier(url: string): string | null {
    const parsed = this.parseSourceUrl(url);
    if (parsed?.hostname.toLowerCase() === "higher.gs.com") {
      return `${GOLDMAN_ORACLE_BOARD.hostname}/${GOLDMAN_ORACLE_BOARD.siteNumber}`;
    }
    if (!parsed || !isOracleCareersHost(parsed.hostname)) {
      return null;
    }
    const brandedSiteNumber = ORACLE_BRANDED_SITE_NUMBERS.get(
      parsed.hostname.toLowerCase()
    );
    if (brandedSiteNumber) {
      return `${parsed.hostname}/${brandedSiteNumber}`;
    }
    const alias = parsed.pathname.match(/\/sites\/([^/]+)/iu)?.[1];
    return alias ? `${parsed.hostname}/${alias}` : null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const board = await this.resolveBoard(url, options?.boardToken);
      if (!board) {
        return this.failure(
          "invalid_url",
          "Oracle careers URL or board token must identify an Oracle host and CX site."
        );
      }
      const boardToken = `${board.hostname}/${board.siteNumber}`;
      const listingResult = await this.fetchAllListings(board);
      if (listingResult.listings.length === 0) {
        const firstFailure = listingResult.failedOffsets[0];
        if (firstFailure?.status) {
          return this.failureForHttpStatus(
            firstFailure.status,
            "Failed to fetch Oracle Recruiting jobs."
          );
        }
        if (firstFailure?.error) return this.failureFromUnknown(firstFailure.error);
        if (listingResult.advertisedTotal === 0 && listingResult.isComplete) {
          return {
            outcome: "success",
            jobs: [],
            totalListings: 0,
            openExternalIds: [],
            listingCompleteness: "complete",
            detectedBoardToken: options?.boardToken ? undefined : boardToken,
          };
        }
        return this.failure("parse_error", "Oracle Recruiting returned no usable jobs.");
      }

      const listings = this.dedupeListings(listingResult.listings);
      const openExternalIds = listings.map((listing) =>
        this.externalId(board, listing.id)
      );
      const selection = selectListingsForHydration({
        listings,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (listing) => ({
          title: listing.title,
          location: listing.location,
        }),
        getExternalId: (listing) => this.externalId(board, listing.id),
      });
      const hydrated = await hydrateDetailsInBatches<
        OracleListing,
        OracleHydratedJob
      >({
        items: selection.listings,
        initialBatchSize: this.config.detailBatchSize,
        initialDelayMs: this.config.detailDelayMs,
        fetcher: (listing) => this.fetchDetail(board, listing),
      });
      let detailFailures = hydrated.failures;
      const jobs = hydrated.results.map((result) => {
        if (result.failed) detailFailures++;
        return result.job;
      });
      const issues = [];
      if (!listingResult.isComplete) {
        issues.push(this.createListingIssue(listingResult, listings.length));
      }
      if (detailFailures > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${detailFailures} Oracle detail request${detailFailures === 1 ? "" : "s"} could not be hydrated; listing data was retained.`
          )
        );
      }

      // Near-complete listings and a handful of failed details degrade to
      // warnings instead of failing the whole board. The denominator is the
      // pre-hydration selection: hydrator-level nulls never reach `jobs`.
      const detailsTolerable = isDetailFailuresTolerable(detailFailures, selection.listings.length);
      return {
        outcome: listingResult.isComplete && detailsTolerable ? "success" : "partial",
        jobs,
        totalListings: listings.length,
        openExternalIds,
        listingCompleteness: listingResult.isComplete ? "complete" : "partial",
        earlyFiltered: selection.earlyFiltered,
        detectedBoardToken: options?.boardToken ? undefined : boardToken,
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private async resolveBoard(url: string, token?: string): Promise<OracleBoard | null> {
    const parsedToken = token?.trim().match(/^([^/]+)\/(CX(?:_\d+)?)$/iu);
    const source = this.parseSourceUrl(url);
    const sourceAlias = source?.pathname.match(/\/sites\/([^/]+)/iu)?.[1];
    const tokenHostname = parsedToken?.[1]?.toLowerCase();
    const tokenSiteNumber = parsedToken?.[2]?.toUpperCase();
    if (tokenHostname && !isOracleCareersHost(tokenHostname)) return null;
    if (
      tokenHostname &&
      ORACLE_BRANDED_HOSTS.has(tokenHostname) &&
      source?.hostname.toLowerCase() !== tokenHostname
    ) {
      return null;
    }
    if (
      tokenHostname &&
      tokenSiteNumber &&
      !ORACLE_BRANDED_HOSTS.has(tokenHostname)
    ) {
      const origin = `https://${tokenHostname}`;
      return {
        origin,
        apiOrigin: origin,
        hostname: tokenHostname,
        siteNumber: tokenSiteNumber,
        siteAlias: sourceAlias || tokenSiteNumber,
      };
    }
    if (source?.hostname.toLowerCase() === "higher.gs.com") {
      return GOLDMAN_ORACLE_BOARD;
    }
    if (!source || !isOracleCareersHost(source.hostname)) {
      return null;
    }
    if (
      sourceAlias?.toUpperCase().match(/^CX(?:_\d+)?$/u) &&
      !ORACLE_BRANDED_HOSTS.has(source.hostname.toLowerCase())
    ) {
      return {
        origin: source.origin,
        apiOrigin: source.origin,
        hostname: source.hostname,
        siteNumber: sourceAlias.toUpperCase(),
        siteAlias: sourceAlias,
      };
    }

    const response = await this.fetchResponse(source.toString(), {
      headers: this.htmlRequestHeaders(),
    });
    if (!response.ok) return null;
    const html = await response.text();
    const siteNumber =
      tokenSiteNumber ||
      html.match(/siteSettings\/(CX(?:_\d+)?)/iu)?.[1] ||
      html.match(/["']siteNumber["']\s*:\s*["'](CX(?:_\d+)?)["']/iu)?.[1] ||
      html.match(/data-sitenumber=["'](CX(?:_\d+)?)["']/iu)?.[1] ||
      html.match(/[?&]siteNumber=(CX(?:_\d+)?)/iu)?.[1];
    if (!siteNumber) return null;
    const apiOrigin = this.extractApiOrigin(html) ?? source.origin;
    if (
      ORACLE_BRANDED_HOSTS.has(source.hostname.toLowerCase()) &&
      apiOrigin === source.origin
    ) {
      return null;
    }
    return {
      origin: source.origin,
      apiOrigin,
      hostname: tokenHostname || source.hostname,
      siteNumber: siteNumber.toUpperCase(),
      siteAlias: sourceAlias || siteNumber.toUpperCase(),
    };
  }

  private extractApiOrigin(html: string): string | null {
    const matchedUrl = html.match(
      /https:\/\/[a-z0-9.-]+\.oraclecloud\.com(?::\d+)?\/(?:hcmRestApi|hcmUI)\//iu
    )?.[0];
    if (!matchedUrl) return null;
    try {
      const parsed = new URL(matchedUrl);
      return parsed.hostname.toLowerCase().endsWith(".oraclecloud.com")
        ? parsed.origin
        : null;
    } catch {
      return null;
    }
  }

  private async fetchAllListings(board: OracleBoard): Promise<{
    listings: OracleListing[];
    advertisedTotal: number;
    failedOffsets: OraclePageFailure[];
    invalidListings: number;
    truncated: boolean;
    isComplete: boolean;
  }> {
    const first = await this.fetchListingPage(board, 0);
    if (!first.ok) {
      return {
        listings: [],
        advertisedTotal: 0,
        failedOffsets: [first],
        invalidListings: 0,
        truncated: false,
        isComplete: false,
      };
    }
    const successes: OraclePageSuccess[] = [first];
    const failedOffsets: OraclePageFailure[] = [];
    const overlap = first.limit >= 50
      ? Math.min(20, Math.ceil(first.limit * 0.05))
      : 0;
    const pageStride = first.limit - overlap;
    const requiredPages = first.totalJobs <= first.limit
      ? 1
      : 1 + Math.ceil((first.totalJobs - first.limit) / pageStride);
    const pageCount = Math.min(requiredPages, this.config.maxListingPages);
    const pageResults = await Promise.all(
      Array.from({ length: Math.max(0, pageCount - 1) }, (_value, index) =>
        this.fetchListingPage(board, first.offset + (index + 1) * pageStride)
      )
    );
    for (const page of pageResults) {
      if (page.ok) successes.push(page);
      else failedOffsets.push(page);
    }
    successes.sort((left, right) => left.offset - right.offset);
    const listings = successes.flatMap((page) => page.listings);
    const advertisedTotal = Math.max(...successes.map((page) => page.totalJobs));
    const invalidListings = successes.reduce(
      (total, page) => total + page.invalidListings,
      0
    );
    const lastPage = successes.at(-1) ?? first;
    const truncated =
      requiredPages > this.config.maxListingPages ||
      (failedOffsets.length === 0 &&
        lastPage.offset + lastPage.limit < advertisedTotal);
    const uniqueCount = this.dedupeListings(listings).length;
    // Board totals routinely drift by a few jobs; exact equality turned
    // "7326 of 7328" into a board failure. Invalid listings are already
    // excluded from `listings`, so they count toward the tolerated gap.
    const { isComplete: countsComplete } = resolveListingCompleteness(
      uniqueCount,
      advertisedTotal
    );
    return {
      listings,
      advertisedTotal,
      failedOffsets,
      invalidListings,
      truncated,
      isComplete:
        failedOffsets.length === 0 &&
        !truncated &&
        countsComplete,
    };
  }

  private async fetchListingPage(
    board: OracleBoard,
    offset: number
  ): Promise<OraclePageResult> {
    try {
      const response = await this.fetchResponse(this.createListingUrl(board, offset), {
        headers: this.jsonRequestHeaders(),
      });
      if (!response.ok) return { ok: false, offset, status: response.status };
      const payload = parseExternalPayload(
        OracleListingPayloadSchema,
        await response.json(),
        `Oracle listings at offset ${offset}`
      );
      const page = payload.items[0];
      if (!page) return { ok: false, offset, error: new TypeError("Missing Oracle page.") };
      const parsed = parseExternalItems(
        OracleListingSchema,
        page.requisitionList,
        `Oracle listings at offset ${offset}`
      );
      return {
        ok: true,
        offset: page.Offset,
        limit: page.Limit,
        totalJobs: page.TotalJobsCount,
        listings: parsed.items.map((listing) => this.mapListing(board, listing)),
        invalidListings: parsed.invalidCount,
      };
    } catch (error) {
      throwIfScrapeAborted(error);
      return { ok: false, offset, error };
    }
  }

  private createListingUrl(board: OracleBoard, offset: number): string {
    const endpoint = new URL(
      "/hcmRestApi/resources/latest/recruitingCEJobRequisitions",
      board.apiOrigin
    );
    endpoint.searchParams.set("onlyData", "true");
    endpoint.searchParams.set(
      "expand",
      "requisitionList.workLocation,requisitionList.otherWorkLocations,requisitionList.secondaryLocations"
    );
    endpoint.searchParams.set(
      "finder",
      `findReqs;${[
        `siteNumber=${board.siteNumber}`,
        "facetsList=WORK_LOCATIONS;WORKPLACE_TYPES;TITLES;CATEGORIES;ORGANIZATIONS;POSTING_DATES;FLEX_FIELDS;LOCATIONS",
        `limit=${this.config.listingPageSize}`,
        `offset=${offset}`,
        "sortBy=POSTING_DATES_DESC",
      ].join(",")}`
    );
    return endpoint.toString();
  }

  private async fetchDetail(
    board: OracleBoard,
    listing: OracleListing
  ): Promise<OracleHydratedJob> {
    let result = await this.fetchDetailOnce(board, listing);
    if (!result.failed) return result;
    await abortableDelay(Math.max(100, this.config.detailDelayMs));
    result = await this.fetchDetailOnce(board, listing);
    return result;
  }

  private async fetchDetailOnce(
    board: OracleBoard,
    listing: OracleListing
  ): Promise<OracleHydratedJob> {
    const fallback = this.mapListingToJob(board, listing);
    try {
      const response = await this.fetchResponse(this.createDetailUrl(board, listing.id), {
        headers: this.jsonRequestHeaders(),
      });
      if (!response.ok) return { job: fallback, failed: true };
      const payload = parseExternalPayload(
        OracleDetailPayloadSchema,
        await response.json(),
        `Oracle job detail ${listing.id}`
      );
      const detail = payload.items[0];
      if (!detail) return { job: fallback, failed: true };
      const description = this.extractDescription(detail);
      const processed = description
        ? processDescription(
            description,
            containsHtml(description) ? "html" : "plain"
          )
        : null;
      const normalizedLocation = this.normalizeLocation(
        this.collectLocations(detail, listing.location) ?? ""
      );
      return {
        failed: !processed?.text,
        job: {
          ...fallback,
          title: detail.Title.trim(),
          location: normalizedLocation.location,
          locationType: this.resolveLocationType(
            detail.WorkplaceType,
            normalizedLocation.locationType
          ),
          department:
            detail.JobFunction ??
            detail.JobFamily ??
            detail.Department ??
            detail.Organization ??
            fallback.department,
          employmentType: parseEmploymentType(detail.JobType ?? listing.jobType),
          description: processed?.text ?? fallback.description,
          descriptionFormat: processed?.format ?? fallback.descriptionFormat,
        },
      };
    } catch (error) {
      throwIfScrapeAborted(error);
      return { job: fallback, failed: true };
    }
  }

  private createDetailUrl(board: OracleBoard, id: string): string {
    const endpoint = new URL(
      "/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails",
      board.apiOrigin
    );
    endpoint.searchParams.set("onlyData", "true");
    endpoint.searchParams.set("expand", "all");
    endpoint.searchParams.set(
      "finder",
      `ById;Id="${id}",siteNumber=${board.siteNumber}`
    );
    return endpoint.toString();
  }

  private mapListing(board: OracleBoard, listing: OracleListingRecord): OracleListing {
    return {
      id: listing.Id,
      title: listing.Title.trim(),
      url: new URL(
        `/hcmUI/CandidateExperience/en/sites/${board.siteAlias}/job/${listing.Id}`,
        board.origin
      ).toString(),
      location: this.collectLocations(listing),
      department:
        listing.JobFunction ??
        listing.JobFamily ??
        listing.Department ??
        listing.Organization ??
        undefined,
      jobType: listing.JobType ?? undefined,
      workplaceType: listing.WorkplaceType ?? undefined,
      postedDate: this.parseDate(listing.PostedDate),
      seniority: this.mapSeniority(listing.Title),
    };
  }

  private mapListingToJob(board: OracleBoard, listing: OracleListing): ScrapedJob {
    const normalizedLocation = this.normalizeLocation(listing.location ?? "");
    return {
      externalId: this.externalId(board, listing.id),
      title: listing.title,
      url: listing.url,
      location: normalizedLocation.location,
      locationType: this.resolveLocationType(
        listing.workplaceType,
        normalizedLocation.locationType
      ),
      department: listing.department,
      employmentType: parseEmploymentType(listing.jobType),
      seniorityLevel: listing.seniority,
      postedDate: listing.postedDate,
    };
  }

  private externalId(board: OracleBoard, id: string): string {
    return this.generateExternalId(
      this.platform,
      board.hostname,
      board.siteNumber,
      id
    );
  }

  private dedupeListings(listings: OracleListing[]): OracleListing[] {
    return Array.from(new Map(listings.map((listing) => [listing.id, listing])).values());
  }

  private collectLocations(
    record: {
      PrimaryLocation?: string | null;
      otherWorkLocations?: Array<{ LocationName?: string | null }>;
      secondaryLocations?: Array<{ LocationName?: string | null }>;
    },
    fallback?: string
  ): string | undefined {
    const locations = [
      record.PrimaryLocation,
      ...(record.otherWorkLocations?.map((location) => location.LocationName) ?? []),
      ...(record.secondaryLocations?.map((location) => location.LocationName) ?? []),
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

  private extractDescription(detail: OracleDetailRecord): string {
    if (detail.ExternalDescriptionStr?.trim()) return detail.ExternalDescriptionStr;
    return [
      detail.ShortDescriptionStr,
      detail.ExternalResponsibilitiesStr,
      detail.ExternalQualificationsStr,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n\n");
  }

  private resolveLocationType(
    workplaceType: string | null | undefined,
    fallback: ScrapedJob["locationType"]
  ): ScrapedJob["locationType"] {
    const normalized = workplaceType?.toLowerCase() ?? "";
    if (normalized.includes("remote")) return "remote";
    if (normalized.includes("hybrid")) return "hybrid";
    return fallback;
  }

  private parseDate(value?: string | null): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private mapSeniority(title: string): SeniorityLevel | undefined {
    const normalized = title.toLowerCase();
    if (/\b(?:intern|graduate|junior|jr\.?)\b/u.test(normalized)) return "entry";
    if (/\b(?:staff|principal|lead|vice president)\b/u.test(normalized)) return "lead";
    if (/\b(?:manager|director)\b/u.test(normalized)) return "manager";
    if (/\b(?:senior|sr\.?)\b/u.test(normalized)) return "senior";
    if (/\bii\b/u.test(normalized)) return "mid";
    return undefined;
  }

  private createListingIssue(
    result: {
      advertisedTotal: number;
      failedOffsets: OraclePageFailure[];
      invalidListings: number;
      truncated: boolean;
    },
    fetched: number
  ) {
    const details = [
      result.failedOffsets.length > 0
        ? `failed offsets: ${result.failedOffsets.map((failure) => failure.offset).join(", ")}`
        : null,
      result.invalidListings > 0 ? `${result.invalidListings} invalid listings` : null,
      result.truncated ? `truncated at ${this.config.maxListingPages} pages` : null,
      fetched < result.advertisedTotal
        ? `received ${fetched} of ${result.advertisedTotal} advertised jobs`
        : null,
    ].filter((detail): detail is string => detail !== null);
    return createScraperError(
      "network_error",
      `Oracle listings were only partially fetched (${details.join("; ") || "unknown pagination failure"}).`
    );
  }
}
