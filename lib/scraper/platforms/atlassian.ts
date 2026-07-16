import { z } from "zod";

import { processDescription } from "@/lib/jobs/description-processor";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import {
  parseExternalPayload,
  type ApiScraperConfig,
  type ScrapeOptions,
  type ScrapedJob,
  type ScraperResult,
} from "@/lib/scraper/types";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import { hydrateDetailsInBatches } from "./shared/detail-hydrator";
import { selectListingsForHydration } from "./shared/listing-selection";

type AtlassianListingRecord = Record<string, unknown>;

// Require one of the listing containers the mapper understands while
// tolerating additive upstream fields.
const AtlassianRecordSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (record) => {
      const identifiers = [record.id, record.jobId, record.requisitionId];
      const titles = [record.title, record.name, record.role];
      const hasIdentifier = identifiers.some(
        (value) =>
          (typeof value === "string" && value.trim().length > 0) ||
          (typeof value === "number" && Number.isFinite(value))
      );
      const hasTitle = titles.some(
        (value) => typeof value === "string" && value.trim().length > 0
      );
      return hasIdentifier && hasTitle;
    },
    { message: "listing must include a supported identifier and title" }
  );
const AtlassianListingsPayloadSchema = z.union([
  z.array(AtlassianRecordSchema),
  z.object({ listings: z.array(AtlassianRecordSchema) }).passthrough(),
  z.object({ jobs: z.array(AtlassianRecordSchema) }).passthrough(),
  z
    .object({
      data: z.union([
        z.array(AtlassianRecordSchema),
        z
          .object({
            listings: z.array(AtlassianRecordSchema).optional(),
            jobs: z.array(AtlassianRecordSchema).optional(),
          })
          .passthrough()
          .refine((value) => Boolean(value.listings || value.jobs), {
            message: "data must contain listings or jobs",
          }),
      ]),
    })
    .passthrough(),
]);

const AtlassianDetailRecordSchema = z.record(z.string(), z.unknown());
const AtlassianDetailPayloadSchema = z.union([
  AtlassianDetailRecordSchema,
  z.object({ data: AtlassianDetailRecordSchema }).passthrough(),
  z.object({ job: AtlassianDetailRecordSchema }).passthrough(),
]);

interface AtlassianListing {
  id: string;
  title: string;
  department?: string;
  location?: string;
  overview?: string;
  responsibilities?: string;
  qualifications?: string;
}

interface AtlassianHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

export type AtlassianConfig = ApiScraperConfig & {
  detailBatchSize: number;
  detailDelayMs: number;
};

const DEFAULT_ATLASSIAN_CONFIG: AtlassianConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://www.atlassian.com",
  detailBatchSize: 4,
  detailDelayMs: 400,
};

export class AtlassianScraper extends AbstractApiScraper<AtlassianConfig> {
  readonly platform = "atlassian" as const;

  constructor(httpClient: IHttpClient, config: Partial<AtlassianConfig> = {}) {
    super(httpClient, { ...DEFAULT_ATLASSIAN_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes("atlassian.com/company/careers/all-jobs") ||
      lower.includes("atlassian.com/company/careers/details") ||
      lower.includes("atlassian.com/company/careers")
    );
  }

  extractIdentifier(url: string): string | null {
    try {
      return new URL(url).hostname || "careers";
    } catch {
      return "careers";
    }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const sourceUrl = this.parseSourceUrl(url);
      if (!sourceUrl) {
        return this.failure("invalid_url", "Invalid Atlassian Careers URL.");
      }
      const origin = sourceUrl.origin;
      const listingsEndpoint = `${origin}/endpoint/careers/listings`;
      const response = await this.fetchResponse(listingsEndpoint, {
        headers: this.jsonRequestHeaders(),
      });

      if (!response.ok) {
        return this.failureForHttpStatus(
          response.status,
          "Failed to fetch Atlassian jobs list.",
        );
      }

      const payload = parseExternalPayload(
        AtlassianListingsPayloadSchema,
        await response.json(),
        "Atlassian listings"
      );
      const allListings = this.extractListings(payload);
      const scopedListings = this.applySourceUrlFilters(allListings, sourceUrl.searchParams);

      const openExternalIds = scopedListings.map((job) =>
        this.generateExternalId(this.platform, job.id)
      );

      if (scopedListings.length === 0) {
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
        listings: scopedListings,
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
          totalListings: scopedListings.length,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingCompleteness: "complete",
        };
      }

      const hydrated = await hydrateDetailsInBatches<AtlassianListing, AtlassianHydratedJob>({
        items: jobsToFetch,
        initialBatchSize: this.config.detailBatchSize,
        initialDelayMs: this.config.detailDelayMs,
        fetcher: async (listing) => this.fetchAndHydrateJob(listing, origin),
      });

      let detailFailures = hydrated.failures;
      const jobs = hydrated.results.map((result) => {
        if (result.failed) detailFailures++;
        return result.job;
      });

      return {
        outcome: detailFailures > 0 ? "partial" : "success",
        jobs,
        totalListings: scopedListings.length,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds,
        listingCompleteness: "complete",
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private applySourceUrlFilters(listings: AtlassianListing[], params: URLSearchParams): AtlassianListing[] {
    const team = params.get("team")?.trim().toLowerCase();
    const location = params.get("location")?.trim().toLowerCase();
    const search = params.get("search")?.trim().toLowerCase();

    if (!team && !location && !search) return listings;

    return listings.filter((listing) => {
      if (team && !(listing.department || "").toLowerCase().includes(team)) {
        return false;
      }

      if (location && !(listing.location || "").toLowerCase().includes(location)) {
        return false;
      }

      if (search) {
        const haystack = [
          listing.title,
          listing.department || "",
          listing.location || "",
          listing.overview || "",
          listing.responsibilities || "",
          listing.qualifications || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }

      return true;
    });
  }

  private extractListings(payload: unknown): AtlassianListing[] {
    const records = this.extractRecords(payload);
    const listings: AtlassianListing[] = [];

    for (const record of records) {
      const listing = this.parseListing(record);
      if (listing) {
        listings.push(listing);
      }
    }

    return listings;
  }

  private extractRecords(payload: unknown): AtlassianListingRecord[] {
    if (Array.isArray(payload)) {
      return payload.filter((item): item is AtlassianListingRecord => this.isRecord(item));
    }

    if (!this.isRecord(payload)) {
      return [];
    }

    const candidates = [
      payload.listings,
      payload.jobs,
      payload.data,
      this.isRecord(payload.data) ? payload.data.listings : undefined,
      this.isRecord(payload.data) ? payload.data.jobs : undefined,
    ];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;
      return candidate.filter((item): item is AtlassianListingRecord => this.isRecord(item));
    }

    return [];
  }

  private parseListing(record: AtlassianListingRecord): AtlassianListing | null {
    const id = this.readId(record.id) ||
      this.readId(record.jobId) ||
      this.readId(record.requisitionId);
    const title = this.readString(record.title) ||
      this.readString(record.name) ||
      this.readString(record.role);

    if (!id || !title) return null;

    const location = this.parseLocation(record.locations, record.location);
    const department = this.readString(record.category) ||
      this.readString(record.team) ||
      this.readString(record.department);

    return {
      id,
      title,
      location,
      department,
      overview: this.readString(record.overview),
      responsibilities: this.readString(record.responsibilities),
      qualifications: this.readString(record.qualifications),
    };
  }

  private parseLocation(locationsValue: unknown, locationValue: unknown): string | undefined {
    if (Array.isArray(locationsValue)) {
      const normalized = locationsValue
        .map((value) => {
          if (typeof value === "string") return value.trim();
          if (!this.isRecord(value)) return "";
          return (
            this.readString(value.name) ||
            this.readString(value.displayName) ||
            this.readString(value.location) ||
            [this.readString(value.city), this.readString(value.country)].filter(Boolean).join(", ")
          );
        })
        .filter((value): value is string => Boolean(value));

      if (normalized.length > 0) {
        return normalized.join(" | ");
      }
    }

    if (typeof locationValue === "string" && locationValue.trim().length > 0) {
      return locationValue.trim();
    }

    return undefined;
  }

  private async fetchAndHydrateJob(
    listing: AtlassianListing,
    origin: string
  ): Promise<AtlassianHydratedJob> {
    const fallback = this.mapListingToJob(listing, origin);
    const listingDescription = this.composeDescription(listing);
    if (listingDescription) {
      return {
        job: {
          ...fallback,
          ...listingDescription,
        },
        failed: false,
      };
    }

    const detailsEndpoint = `${origin}/endpoint/careers/details/${encodeURIComponent(listing.id)}`;
    const response = await this.fetchResponse(detailsEndpoint, {
      headers: this.jsonRequestHeaders(),
    });

    if (!response.ok) {
      return { job: fallback, failed: true };
    }

    const payload = parseExternalPayload(
      AtlassianDetailPayloadSchema,
      await response.json(),
      "Atlassian detail"
    );
    const detailRecord = this.resolveDetailRecord(payload);
    if (!detailRecord) {
      return { job: fallback, failed: true };
    }

    const detailListing = this.parseListing({
      ...detailRecord,
      id: detailRecord.id ?? listing.id,
      title: detailRecord.title ?? listing.title,
      category: detailRecord.category ?? listing.department,
      location: detailRecord.location ?? listing.location,
      locations: detailRecord.locations,
    });

    if (!detailListing) {
      return { job: fallback, failed: true };
    }

    const detailDescription = this.composeDescription(detailListing);
    return {
      job: {
        ...fallback,
        title: detailListing.title || fallback.title,
        location: this.normalizeLocation(detailListing.location || "").location,
        department: detailListing.department || fallback.department,
        ...(detailDescription || {}),
      },
      failed: !detailDescription?.description,
    };
  }

  private resolveDetailRecord(payload: unknown): AtlassianListingRecord | null {
    if (this.isRecord(payload)) {
      if (this.isRecord(payload.data)) return payload.data;
      if (this.isRecord(payload.job)) return payload.job;
      return payload;
    }

    return null;
  }

  private composeDescription(
    listing: Pick<AtlassianListing, "overview" | "responsibilities" | "qualifications">
  ): Pick<ScrapedJob, "description" | "descriptionFormat"> | undefined {
    const sections: string[] = [];

    if (listing.overview) {
      sections.push(`<h3>Overview</h3>\n${listing.overview}`);
    }
    if (listing.responsibilities) {
      sections.push(`<h3>Responsibilities</h3>\n${listing.responsibilities}`);
    }
    if (listing.qualifications) {
      sections.push(`<h3>Qualifications</h3>\n${listing.qualifications}`);
    }

    if (sections.length === 0) return undefined;

    const processed = processDescription(sections.join("\n"), "html");
    return {
      description: processed.text ?? undefined,
      descriptionFormat: processed.format,
    };
  }

  private mapListingToJob(listing: AtlassianListing, origin: string): ScrapedJob {
    const normalizedLocation = this.normalizeLocation(listing.location || "");

    return {
      externalId: this.generateExternalId(this.platform, listing.id),
      title: listing.title,
      url: `${origin}/company/careers/details/${listing.id}`,
      location: normalizedLocation.location,
      locationType: normalizedLocation.locationType,
      department: listing.department,
    };
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readId(value: unknown): string | undefined {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    return undefined;
  }

  private isRecord(value: unknown): value is AtlassianListingRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
}
