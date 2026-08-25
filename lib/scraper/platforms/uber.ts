import { load, type CheerioAPI } from "cheerio";

import { containsHtml, processDescription } from "@/lib/jobs/description-processor";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import {
  createScraperError,
  type ApiScraperConfig,
  type ScrapedJob,
  type ScrapeOptions,
  type ScraperResult,
  type SeniorityLevel,
} from "@/lib/scraper/types";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import { hydrateDetailsInBatches } from "./shared/detail-hydrator";
import {
  fetchPaginatedHtmlByPageParam,
  resolveUrl,
} from "./shared/html-pagination";
import { selectListingsForHydration } from "./shared/listing-selection";

interface UberListingJob {
  id: string;
  title: string;
  url: string;
  location?: string;
  department?: string;
  seniority?: SeniorityLevel;
}

interface UberHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

export type UberConfig = ApiScraperConfig & {
  detailBatchSize: number;
  detailDelayMs: number;
  maxPages: number;
};

const DEFAULT_UBER_CONFIG: UberConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://jobs.uber.com",
  detailBatchSize: 4,
  detailDelayMs: 400,
  maxPages: 150,
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

  extractIdentifier(): string {
    return "global";
  }

  async scrape(_url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const listingUrl = `${this.config.baseUrl}/en/jobs/`;
      const pagedResult = await fetchPaginatedHtmlByPageParam({
        httpClient: this.httpClient,
        startUrl: listingUrl,
        headers: this.requestHeaders("text/html"),
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
        maxPages: this.config.maxPages,
      });

      if (pagedResult.pages.length === 0) {
        const message = "Failed to fetch Uber Careers listing pages.";
        return pagedResult.firstFailureStatus
          ? this.failureForHttpStatus(pagedResult.firstFailureStatus, message)
          : this.failure("network_error", message);
      }

      const extractedByPage = pagedResult.pages.map((page) =>
        this.extractListings(page.html, page.url)
      );
      const hasUnrecognizedPage = extractedByPage.some(
        (listings) => listings.length === 0
      );
      const listings = this.dedupeListings(extractedByPage.flat());

      if (listings.length === 0) {
        return this.failure(
          "network_error",
          "Uber Careers returned no recognized job cards; the site may be serving a verification page."
        );
      }

      const listingIsComplete = pagedResult.isComplete && !hasUnrecognizedPage;
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
          outcome: listingIsComplete ? "success" : "partial",
          jobs: [],
          totalListings: listings.length,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds,
          listingCompleteness: listingIsComplete ? "complete" : "partial",
          issues: listingIsComplete
            ? undefined
            : [this.createListingIssue(pagedResult.failedPages.length)],
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
      const isPartial = detailFailures > 0 || !listingIsComplete;
      const issues = [];
      if (!listingIsComplete) {
        issues.push(this.createListingIssue(pagedResult.failedPages.length));
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
        listingCompleteness: listingIsComplete ? "complete" : "partial",
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private extractListings(html: string, pageUrl: string): UberListingJob[] {
    const $ = load(html);
    const listings: UberListingJob[] = [];

    $('[data-slot="card"][data-id]').each((_index, element) => {
      const card = $(element);
      const link = card.find("a.js-view-job[href]").first();
      const href = link.attr("href");
      const id = card.attr("data-id")?.trim();
      const title = link.text().replace(/\s+/g, " ").trim();
      if (!href || !id || !title) return;

      const badges = card
        .find('[data-slot="card-description"] > div > div')
        .map((_badgeIndex, badge) =>
          $(badge).text().replace(/\s+/g, " ").trim()
        )
        .get()
        .filter(Boolean);

      listings.push({
        id,
        title,
        url: resolveUrl(pageUrl, href),
        location: badges[0],
        department: badges[1],
        seniority: this.mapSeniority(title),
      });
    });

    return listings;
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
    const response = await this.fetchResponse(listing.url, {
      headers: this.requestHeaders("text/html"),
    });
    if (!response.ok) return { job: fallback, failed: true };

    const html = await response.text();
    const $ = load(html);
    const rawDescription = this.extractDescriptionHtml($);
    if (!rawDescription) return { job: fallback, failed: true };
    const processed = processDescription(
      rawDescription,
      containsHtml(rawDescription) ? "html" : "plain"
    );
    const detailTitle = $("main h1").first().text().trim();

    return {
      failed: false,
      job: {
        ...fallback,
        title: detailTitle || fallback.title,
        description: processed.text ?? undefined,
        descriptionFormat: processed.format,
        postedDate: this.extractPostedDate($("main").first().text()),
      },
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
      seniorityLevel: listing.seniority,
    };
  }

  private extractDescriptionHtml($: CheerioAPI): string {
    const relevantHeading =
      /about the role|what you.ll do|basic qualifications|preferred qualifications/i;
    const headings = $("main h2, main h3")
      .filter((_index, element) => relevantHeading.test($(element).text().trim()))
      .toArray();
    if (headings.length === 0) return "";

    return headings
      .map((heading) => {
        const headingElement = $(heading);
        const body = headingElement
          .nextUntil("h2, h3")
          .toArray()
          .map((node) => $.html(node))
          .join("\n");
        return `${$.html(headingElement)}\n${body}`;
      })
      .join("\n");
  }

  private extractPostedDate(text: string): Date | undefined {
    const match = text.match(/Posted on\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
    if (!match?.[1]) return undefined;
    const parsed = new Date(match[1]);
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

  private createListingIssue(failedPageCount: number) {
    return createScraperError(
      "network_error",
      `Uber listings were only partially fetched (${failedPageCount} page${failedPageCount === 1 ? "" : "s"} failed or returned an unrecognized layout).`
    );
  }
}
