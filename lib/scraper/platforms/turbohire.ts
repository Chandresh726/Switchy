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
  parseExternalItems,
  parseExternalPayload,
} from "@/lib/scraper/types";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type {
  ApiScraperConfig,
  ScrapeOptions,
  ScrapedJob,
  ScraperResult,
} from "../core/types";
import { selectListingsForHydration } from "./shared/listing-selection";

const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const TurboHireTokenSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    expires_in: z.number().positive(),
  })
  .passthrough();

const TurboHireJobSchema = z
  .object({
    JobId: z.union([z.string(), z.number()]),
    JobIdObfuscated: z.string().min(1),
    JobTitle: z.string().min(1),
    Department: z.unknown().optional(),
    PublishedDate: z.string().nullish(),
    UpdatedDate: z.string().nullish(),
    Location: z.unknown().optional(),
    Type: z.unknown().optional(),
    Experience: z.unknown().optional(),
    Skills: z.unknown().optional(),
    JobDescV2: z.string().nullish(),
  })
  .passthrough();

const TurboHireJobsEnvelopeSchema = z
  .object({
    Total: z.number().int().nonnegative(),
    Result: z.array(z.unknown()),
  })
  .passthrough();

type TurboHireJob = z.infer<typeof TurboHireJobSchema>;
type TurboHireToken = z.infer<typeof TurboHireTokenSchema>;

export type TurboHireConfig = ApiScraperConfig;

const DEFAULT_TURBOHIRE_CONFIG: TurboHireConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://thapi.azurewebsites.net/api",
};

const EMPTY_FILTER_VALUE = { Value: null, FilterType: 0 } as const;

const TURBOHIRE_FILTER_PAYLOAD = {
  SortByV2: { Key: "PostedDate", Order: 2 },
  BunitIds: EMPTY_FILTER_VALUE,
  Experience: EMPTY_FILTER_VALUE,
  JobTypes: EMPTY_FILTER_VALUE,
  JobTypeV2: EMPTY_FILTER_VALUE,
  Locations: EMPTY_FILTER_VALUE,
  CreatedDate: EMPTY_FILTER_VALUE,
  Compensation: EMPTY_FILTER_VALUE,
  Skills: EMPTY_FILTER_VALUE,
  Keyword: "",
  ClientIds: EMPTY_FILTER_VALUE,
  Department: "",
  CustomFields: {},
} as const;

export class TurboHireScraper extends AbstractApiScraper<TurboHireConfig> {
  readonly platform = "turbohire" as const;

  constructor(httpClient: IHttpClient, config: Partial<TurboHireConfig> = {}) {
    super(httpClient, { ...DEFAULT_TURBOHIRE_CONFIG, ...config });
  }

  validate(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.toLowerCase().endsWith(".turbohire.co") &&
        /^\/careerpage\/[0-9a-f-]+\/?$/iu.test(parsed.pathname) &&
        this.extractIdentifier(url) !== null
      );
    } catch {
      return false;
    }
  }

  extractIdentifier(url: string): string | null {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split("/").filter(Boolean);
      const careerPageIndex = segments.findIndex(
        (segment) => segment.toLowerCase() === "careerpage"
      );
      const identifier = segments[careerPageIndex + 1];
      return identifier && ORGANIZATION_ID_PATTERN.test(identifier)
        ? identifier.toLowerCase()
        : null;
    } catch {
      return null;
    }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const sourceUrl = this.parseSourceUrl(url);
      if (!sourceUrl) {
        return this.failure("invalid_url", "Invalid TurboHire career-page URL.");
      }

      const organizationId = this.resolveOrganizationId(url, options?.boardToken);
      if (!organizationId) {
        return this.failure(
          "board_not_found",
          "Could not determine the TurboHire organization UUID."
        );
      }

      const origin = sourceUrl.origin;
      let token = await this.fetchGuestToken(origin);
      let response = await this.fetchJobs(organizationId, origin, token);

      if (response.status === 401 || response.status === 403) {
        token = await this.fetchGuestToken(origin);
        response = await this.fetchJobs(organizationId, origin, token);
      }

      if (!response.ok) {
        return this.failureForHttpStatus(
          response.status,
          `Failed to fetch TurboHire jobs: HTTP ${response.status}`
        );
      }

      const envelope = parseExternalPayload(
        TurboHireJobsEnvelopeSchema,
        await response.json(),
        "TurboHire jobs"
      );
      const parsedItems = parseExternalItems(
        TurboHireJobSchema,
        envelope.Result,
        "TurboHire job items"
      );
      const jobsById = new Map<string, TurboHireJob>();
      for (const job of parsedItems.items) {
        jobsById.set(String(job.JobId), job);
      }
      const listings = Array.from(jobsById.values());
      const isComplete =
        parsedItems.invalidCount === 0 && listings.length >= envelope.Total;
      const openExternalIds = listings.map((job) =>
        this.generateExternalId(this.platform, organizationId, String(job.JobId))
      );

      if (listings.length === 0) {
        return envelope.Total === 0 && parsedItems.invalidCount === 0
          ? {
              outcome: "success",
              jobs: [],
              totalListings: 0,
              detectedBoardToken: options?.boardToken ? undefined : organizationId,
              openExternalIds,
              listingCompleteness: "complete",
            }
          : {
              outcome: "partial",
              jobs: [],
              totalListings: envelope.Total,
              detectedBoardToken: options?.boardToken ? undefined : organizationId,
              listingCompleteness: "unknown",
            };
      }

      const selection = selectListingsForHydration({
        listings,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (job) => ({
          title: job.JobTitle,
          location: this.stringifyValue(job.Location),
        }),
        getExternalId: (job) =>
          this.generateExternalId(this.platform, organizationId, String(job.JobId)),
      });
      const jobs = selection.listings.map((job) =>
        this.mapJob(job, organizationId, origin)
      );

      return {
        outcome: isComplete ? "success" : "partial",
        jobs,
        totalListings: listings.length,
        detectedBoardToken: options?.boardToken ? undefined : organizationId,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds,
        listingCompleteness: isComplete ? "complete" : "partial",
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private resolveOrganizationId(
    url: string,
    boardToken: string | undefined
  ): string | null {
    const normalizedToken = boardToken?.trim().toLowerCase();
    if (normalizedToken && ORGANIZATION_ID_PATTERN.test(normalizedToken)) {
      return normalizedToken;
    }
    return this.extractIdentifier(url);
  }

  private async fetchGuestToken(origin: string): Promise<TurboHireToken> {
    const response = await this.fetchResponse(`${this.config.baseUrl}/token/noauth`, {
      headers: this.requestHeaders("application/json, text/plain, */*", {
        Origin: origin,
        Referer: `${origin}/`,
      }),
    });
    if (!response.ok) {
      throw new HttpError(
        response.status,
        `Failed to fetch TurboHire guest token: HTTP ${response.status}`,
        `${this.config.baseUrl}/token/noauth`
      );
    }
    return parseExternalPayload(
      TurboHireTokenSchema,
      await response.json(),
      "TurboHire guest token"
    );
  }

  private fetchJobs(
    organizationId: string,
    origin: string,
    token: TurboHireToken
  ): Promise<Response> {
    const endpoint =
      `${this.config.baseUrl}/careerpagev2/filteredjobs` +
      `?orgId=${encodeURIComponent(organizationId)}&pageType=0`;
    return this.fetchResponse(endpoint, {
      method: "POST",
      headers: this.requestHeaders("application/json, text/plain, */*", {
        Authorization: `${token.token_type} ${token.access_token}`,
        "Content-Type": "application/json",
        Origin: origin,
        Referer: `${origin}/`,
      }),
      body: JSON.stringify(TURBOHIRE_FILTER_PAYLOAD),
    });
  }

  private mapJob(
    job: TurboHireJob,
    organizationId: string,
    origin: string
  ): ScrapedJob {
    const rawLocation = this.stringifyValue(job.Location);
    const { location, locationType } = this.normalizeLocation(rawLocation);
    const description = job.JobDescV2?.trim();
    const processedDescription = description
      ? processDescription(description, containsHtml(description) ? "html" : "plain")
      : { text: null, format: "plain" as const };
    const postedDate = this.parseDate(job.PublishedDate ?? job.UpdatedDate);

    return {
      externalId: this.generateExternalId(
        this.platform,
        organizationId,
        String(job.JobId)
      ),
      title: job.JobTitle.trim(),
      url: `${origin}/job/publicjobs/${job.JobIdObfuscated}`,
      location,
      locationType,
      department: this.stringifyValue(job.Department) || undefined,
      description: processedDescription.text ?? undefined,
      descriptionFormat: processedDescription.format,
      employmentType: parseEmploymentType(this.stringifyValue(job.Type)),
      postedDate: postedDate ?? undefined,
    };
  }

  private stringifyValue(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) {
      return value.map((entry) => this.stringifyValue(entry)).filter(Boolean).join(", ");
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      for (const key of ["Name", "name", "Value", "value", "Location", "location"]) {
        const normalized = this.stringifyValue(record[key]);
        if (normalized) return normalized;
      }
    }
    return "";
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
