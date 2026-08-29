import { z } from "zod";

import { processDescription } from "@/lib/jobs/description-processor";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import {
  HttpError,
  type IHttpClient,
} from "@/lib/scraper/infrastructure/http-client";
import {
  createScraperError,
  type ApiScraperConfig,
  type EmploymentType,
  type ScraperError,
  type ScrapedJob,
  type ScrapeOptions,
  type ScraperResult,
  type SeniorityLevel,
} from "@/lib/scraper/types";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import { hydrateDetailsInBatches } from "./shared/detail-hydrator";
import { selectListingsForHydration } from "./shared/listing-selection";

const SMARTRECRUITERS_HOSTS = new Set([
  "careers.smartrecruiters.com",
  "jobs.smartrecruiters.com",
]);

const SECTION_ORDER = [
  "companyDescription",
  "jobDescription",
  "qualifications",
  "additionalInformation",
] as const;

const LabelSchema = z
  .object({ label: z.string().nullish() })
  .passthrough()
  .nullish();

const LocationSchema = z
  .object({
    fullLocation: z.string().nullish(),
    city: z.string().nullish(),
    region: z.string().nullish(),
    country: z.string().nullish(),
    remote: z.boolean().nullish(),
    hybrid: z.boolean().nullish(),
  })
  .passthrough()
  .nullish();

const SmartRecruitersListingSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    name: z.string().min(1),
    postingUrl: z.string().url().nullish(),
    releasedDate: z.string().nullish(),
    location: LocationSchema,
    department: LabelSchema,
    function: LabelSchema,
    type: LabelSchema,
    typeOfEmployment: LabelSchema,
    experienceLevel: LabelSchema,
  })
  .passthrough();

const SmartRecruitersListingPageSchema = z
  .object({
    totalFound: z.number().int().nonnegative(),
    content: z.array(z.unknown()),
  })
  .passthrough();

const SmartRecruitersSectionSchema = z
  .object({
    title: z.string().nullish(),
    text: z.string().nullish(),
  })
  .passthrough()
  .nullish();

const SmartRecruitersDetailSchema = SmartRecruitersListingSchema.extend({
  customField: z
    .array(
      z
        .object({
          fieldLabel: z.string().nullish(),
          valueLabel: z.string().nullish(),
          value: z.union([z.string(), z.number(), z.boolean()]).nullish(),
        })
        .passthrough()
    )
    .nullish(),
  jobAd: z
    .object({
      sections: z
        .object({
          companyDescription: SmartRecruitersSectionSchema,
          jobDescription: SmartRecruitersSectionSchema,
          qualifications: SmartRecruitersSectionSchema,
          additionalInformation: SmartRecruitersSectionSchema,
        })
        .passthrough()
        .nullish(),
    })
    .passthrough()
    .nullish(),
}).passthrough();

type SmartRecruitersListing = z.infer<typeof SmartRecruitersListingSchema>;
type SmartRecruitersDetail = z.infer<typeof SmartRecruitersDetailSchema>;

interface SmartRecruitersHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

interface SmartRecruitersListingResult {
  listings: SmartRecruitersListing[];
  isComplete: boolean;
  issues: ScraperError[];
}

export type SmartRecruitersConfig = ApiScraperConfig & {
  detailBatchSize: number;
  detailDelayMs: number;
  listingPageSize: number;
};

const DEFAULT_SMARTRECRUITERS_CONFIG: SmartRecruitersConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://api.smartrecruiters.com/v1/companies",
  timeout: 128_000,
  detailBatchSize: 4,
  detailDelayMs: 500,
  listingPageSize: 100,
};

export class SmartRecruitersScraper extends AbstractApiScraper<SmartRecruitersConfig> {
  readonly platform = "smartrecruiters" as const;

  constructor(
    httpClient: IHttpClient,
    config: Partial<SmartRecruitersConfig> = {}
  ) {
    super(httpClient, { ...DEFAULT_SMARTRECRUITERS_CONFIG, ...config });
  }

  validate(url: string): boolean {
    try {
      return SMARTRECRUITERS_HOSTS.has(new URL(url).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  extractIdentifier(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!SMARTRECRUITERS_HOSTS.has(parsed.hostname.toLowerCase())) return null;
      const [identifier] = parsed.pathname.split("/").filter(Boolean);
      return identifier ? decodeURIComponent(identifier) : null;
    } catch {
      return null;
    }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const identifier = options?.boardToken?.trim() || this.extractIdentifier(url);
      if (!identifier) {
        return this.failure(
          "invalid_url",
          "Could not resolve the SmartRecruiters company identifier. Use a canonical SmartRecruiters URL or provide it manually."
        );
      }

      const detectedBoardToken = !options?.boardToken ? identifier : undefined;
      const listingResult = await this.fetchListings(identifier);
      const openExternalIds = listingResult.listings.map((listing) =>
        this.externalId(identifier, listing.id)
      );
      const selection = selectListingsForHydration({
        listings: listingResult.listings,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (listing) => ({
          title: listing.name,
          location: this.locationText(listing.location),
        }),
        getExternalId: (listing) => this.externalId(identifier, listing.id),
      });

      const hydrated = await hydrateDetailsInBatches<
        SmartRecruitersListing,
        SmartRecruitersHydratedJob
      >({
        items: selection.listings,
        initialBatchSize: this.config.detailBatchSize,
        minBatchSize: this.config.detailBatchSize,
        maxBatchSize: this.config.detailBatchSize,
        initialDelayMs: this.config.detailDelayMs,
        minDelayMs: this.config.detailDelayMs,
        maxDelayMs: this.config.detailDelayMs,
        fetcher: (listing) => this.fetchAndHydrateJob(identifier, listing),
      });

      let detailFailures = hydrated.failures;
      const jobs = hydrated.results.map((result) => {
        if (result.failed) detailFailures += 1;
        return result.job;
      });
      const issues = [...listingResult.issues];
      if (detailFailures > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${detailFailures} SmartRecruiters job detail request${detailFailures === 1 ? "" : "s"} failed; listing data was retained.`
          )
        );
      }

      return {
        outcome: issues.length > 0 ? "partial" : "success",
        jobs,
        totalListings: listingResult.listings.length,
        detectedBoardToken,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds,
        listingCompleteness: listingResult.isComplete ? "complete" : "partial",
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private async fetchListings(identifier: string): Promise<SmartRecruitersListingResult> {
    const listings = new Map<string, SmartRecruitersListing>();
    const issues: ScraperError[] = [];
    let expectedTotal: number | null = null;
    let offset = 0;
    let isComplete = true;

    while (expectedTotal === null || listings.size < expectedTotal) {
      const url = this.listingUrl(identifier, offset);
      let response: Response;
      try {
        response = await this.fetchResponse(url, {
          headers: this.jsonRequestHeaders(),
          maxDelay: this.config.timeout,
        });
      } catch (error) {
        throwIfScrapeAborted(error);
        if (offset === 0) throw error;
        isComplete = false;
        issues.push(this.failureFromUnknown(error).error);
        break;
      }

      if (!response.ok) {
        if (offset === 0) {
          throw new HttpError(
            response.status,
            `Failed to fetch SmartRecruiters listings: ${response.status}`,
            url
          );
        }
        isComplete = false;
        issues.push(
          this.failureForHttpStatus(
            response.status,
            `Failed to fetch SmartRecruiters listings: ${response.status}`
          ).error
        );
        break;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const parsedPage = SmartRecruitersListingPageSchema.safeParse(payload);
      if (!parsedPage.success) {
        isComplete = false;
        issues.push(
          createScraperError(
            "parse_error",
            "SmartRecruiters returned a malformed listing page."
          )
        );
        break;
      }

      const page = parsedPage.data;
      if (expectedTotal === null) expectedTotal = page.totalFound;
      if (page.totalFound !== expectedTotal) {
        isComplete = false;
        issues.push(
          createScraperError(
            "parse_error",
            "SmartRecruiters changed totalFound during pagination."
          )
        );
      }

      let invalidItems = 0;
      let duplicateItems = 0;
      let addedItems = 0;
      for (const item of page.content) {
        const parsed = SmartRecruitersListingSchema.safeParse(item);
        if (!parsed.success) {
          invalidItems += 1;
          continue;
        }
        if (listings.has(parsed.data.id)) {
          duplicateItems += 1;
          continue;
        }
        listings.set(parsed.data.id, parsed.data);
        addedItems += 1;
      }

      if (invalidItems > 0) {
        isComplete = false;
        issues.push(
          createScraperError(
            "parse_error",
            `${invalidItems} SmartRecruiters listing item${invalidItems === 1 ? " was" : "s were"} malformed.`
          )
        );
      }
      if (duplicateItems > 0) {
        isComplete = false;
        issues.push(
          createScraperError(
            "parse_error",
            `${duplicateItems} overlapping SmartRecruiters listing item${duplicateItems === 1 ? " was" : "s were"} returned.`
          )
        );
      }

      offset += page.content.length;
      if (listings.size >= (expectedTotal ?? 0)) break;
      if (page.content.length < this.config.listingPageSize || addedItems === 0) {
        isComplete = false;
        issues.push(
          createScraperError(
            "parse_error",
            "SmartRecruiters returned a short listing page before totalFound was reached."
          )
        );
        break;
      }
    }

    if (expectedTotal !== null && listings.size !== expectedTotal) {
      isComplete = false;
      if (issues.length === 0) {
        issues.push(
          createScraperError(
            "parse_error",
            "SmartRecruiters listing count did not match totalFound."
          )
        );
      }
    }
    return { listings: [...listings.values()], isComplete, issues };
  }

  private async fetchAndHydrateJob(
    identifier: string,
    listing: SmartRecruitersListing
  ): Promise<SmartRecruitersHydratedJob> {
    const fallback = this.mapJob(identifier, listing);

    try {
      const response = await this.fetchResponse(this.detailUrl(identifier, listing.id), {
        headers: this.jsonRequestHeaders(),
        maxDelay: this.config.timeout,
      });
      if (!response.ok) return { job: fallback, failed: true };
      const parsed = SmartRecruitersDetailSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.id !== listing.id) {
        return { job: fallback, failed: true };
      }
      return { job: this.mapJob(identifier, listing, parsed.data), failed: false };
    } catch (error) {
      throwIfScrapeAborted(error);
      return { job: fallback, failed: true };
    }
  }

  private mapJob(
    identifier: string,
    listing: SmartRecruitersListing,
    detail?: SmartRecruitersDetail
  ): ScrapedJob {
    const source = detail ?? listing;
    const normalizedLocation = this.normalizeLocation(this.locationText(source.location));
    const description = detail ? this.descriptionFrom(detail) : {};

    return {
      externalId: this.externalId(identifier, listing.id),
      title: source.name,
      url:
        source.postingUrl ||
        listing.postingUrl ||
        this.canonicalPostingUrl(identifier, listing.id),
      location: normalizedLocation.location,
      locationType: source.location?.hybrid
        ? "hybrid"
        : source.location?.remote
          ? "remote"
          : normalizedLocation.locationType,
      department: this.departmentFrom(listing, detail),
      employmentType: this.employmentTypeFrom(
        source.typeOfEmployment?.label ?? source.type?.label ?? undefined
      ),
      seniorityLevel: this.seniorityFrom(source.experienceLevel?.label ?? undefined),
      postedDate: this.dateFrom(source.releasedDate ?? listing.releasedDate),
      ...description,
    };
  }

  private descriptionFrom(
    detail: SmartRecruitersDetail
  ): Pick<ScrapedJob, "description" | "descriptionFormat"> {
    const sections = detail.jobAd?.sections;
    if (!sections) return {};
    const html = SECTION_ORDER.flatMap((key) => {
      const section = sections[key];
      if (!section?.text?.trim()) return [];
      const title = section.title?.trim();
      return [`${title ? `<h2>${this.escapeHtml(title)}</h2>` : ""}${section.text.trim()}`];
    }).join("\n");
    if (!html) return {};
    const processed = processDescription(html, "html");
    return {
      description: processed.text ?? undefined,
      descriptionFormat: processed.format,
    };
  }

  private departmentFrom(
    listing: SmartRecruitersListing,
    detail?: SmartRecruitersDetail
  ): string | undefined {
    if (detail?.customField) {
      const customDepartment = detail.customField.find(
        (field) => field.fieldLabel?.trim().toLowerCase() === "department name"
      );
      const value = customDepartment?.valueLabel ?? customDepartment?.value;
      if (value !== null && value !== undefined && String(value).trim()) {
        return String(value).trim();
      }
    }
    const source = detail ?? listing;
    return source.department?.label?.trim() || source.function?.label?.trim() || undefined;
  }

  private employmentTypeFrom(label: string | undefined): EmploymentType | undefined {
    const normalized = label?.toLowerCase();
    if (!normalized) return undefined;
    if (normalized.includes("intern")) return "intern";
    if (normalized.includes("part")) return "part-time";
    if (normalized.includes("contract")) return "contract";
    if (normalized.includes("temporary")) return "temporary";
    if (normalized.includes("full") || normalized.includes("permanent")) return "full-time";
    return undefined;
  }

  private seniorityFrom(label: string | undefined): SeniorityLevel | undefined {
    const normalized = label?.toLowerCase().replace(/[_-]+/g, " ");
    if (!normalized) return undefined;
    if (
      normalized.includes("director") ||
      normalized.includes("executive") ||
      normalized.includes("manager")
    ) {
      return "manager";
    }
    if (normalized.includes("lead")) return "lead";
    if (normalized.includes("senior") || normalized.includes("mid senior")) return "senior";
    if (normalized.includes("associate")) return "mid";
    if (normalized.includes("entry") || normalized.includes("intern")) return "entry";
    return undefined;
  }

  private locationText(location: z.infer<typeof LocationSchema>): string | undefined {
    if (!location) return undefined;
    if (location.fullLocation?.trim()) return location.fullLocation.trim();
    const parts = [location.city, location.region, location.country]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(", ") : undefined;
  }

  private dateFrom(value: string | null | undefined): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private externalId(identifier: string, postingId: string): string {
    return this.generateExternalId(this.platform, identifier, postingId);
  }

  private listingUrl(identifier: string, offset: number): string {
    return `${this.config.baseUrl}/${encodeURIComponent(identifier)}/postings?destination=PUBLIC&limit=${this.config.listingPageSize}&offset=${offset}`;
  }

  private detailUrl(identifier: string, postingId: string): string {
    return `${this.config.baseUrl}/${encodeURIComponent(identifier)}/postings/${encodeURIComponent(postingId)}`;
  }

  private canonicalPostingUrl(identifier: string, postingId: string): string {
    return `https://jobs.smartrecruiters.com/${encodeURIComponent(identifier)}/${encodeURIComponent(postingId)}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}
