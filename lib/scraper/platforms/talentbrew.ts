import { load } from "cheerio";

import {
  containsHtml,
  processDescription,
} from "@/lib/jobs/description-processor";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { createScraperError } from "@/lib/scraper/types";

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

interface TalentBrewListing {
  id: string;
  title: string;
  url: string;
  location?: string;
}

interface TalentBrewPage {
  listings: TalentBrewListing[];
  invalidListings: number;
  totalPages: number;
  advertisedTotal: number | null;
  ajaxPath: string;
  companyId?: string;
  recordsPerPage: number;
}

interface TalentBrewHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

export type TalentBrewConfig = ApiScraperConfig & {
  maxListingPages: number;
  detailBatchSize: number;
  detailDelayMs: number;
};

const DEFAULT_TALENTBREW_CONFIG: TalentBrewConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://jobs.intuit.com/search-jobs",
  maxListingPages: 100,
  detailBatchSize: 5,
  detailDelayMs: 200,
};

export class TalentBrewScraper extends AbstractApiScraper<TalentBrewConfig> {
  readonly platform = "talentbrew" as const;

  constructor(httpClient: IHttpClient, config: Partial<TalentBrewConfig> = {}) {
    super(httpClient, { ...DEFAULT_TALENTBREW_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const parsed = this.parseSourceUrl(url);
    if (!parsed) return false;
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "jobs.intuit.com" || hostname === "careers.intuit.com";
  }

  extractIdentifier(url: string): string | null {
    return this.validate(url) ? "27595" : null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const source = this.parseSourceUrl(url);
      if (!source) return this.failure("invalid_url", "Invalid TalentBrew careers URL.");
      const searchUrl = new URL("/search-jobs", source.origin);
      const firstResponse = await this.fetchResponse(searchUrl.toString(), {
        headers: this.htmlRequestHeaders(),
      });
      if (!firstResponse.ok) {
        return this.failureForHttpStatus(
          firstResponse.status,
          "Failed to fetch the TalentBrew search page."
        );
      }

      const firstPage = this.parsePage(await firstResponse.text(), searchUrl.toString());
      const companyId =
        options?.boardToken?.trim() ||
        firstPage.companyId ||
        this.extractIdentifier(url);
      if (!companyId || !/^\d+$/u.test(companyId)) {
        return this.failure(
          "parse_error",
          "TalentBrew search page did not expose a numeric company identifier."
        );
      }

      const listings = new Map<string, TalentBrewListing>();
      for (const listing of firstPage.listings) listings.set(listing.id, listing);
      const failedPages: number[] = [];
      const totalPages = Math.min(firstPage.totalPages, this.config.maxListingPages);
      const truncated = firstPage.totalPages > this.config.maxListingPages;

      for (let page = 2; page <= totalPages; page++) {
        const pageUrl = new URL(firstPage.ajaxPath, source.origin);
        this.setPaginationParams(pageUrl, page, firstPage.recordsPerPage);
        try {
          const response = await this.fetchResponse(pageUrl.toString(), {
            headers: this.htmlRequestHeaders({
              "X-Requested-With": "XMLHttpRequest",
            }),
          });
          if (!response.ok) {
            failedPages.push(page);
            continue;
          }
          const parsed = this.parsePage(
            this.extractAjaxResults(await response.text()),
            pageUrl.toString()
          );
          for (const listing of parsed.listings) listings.set(listing.id, listing);
        } catch (error) {
          throwIfScrapeAborted(error);
          failedPages.push(page);
        }
      }

      const allListings = Array.from(listings.values());
      // Invalid listings are already excluded from `allListings`, so they
      // count toward the tolerated gap. A null advertised total cannot be
      // verified, so it stays incomplete.
      const { isComplete: countsComplete } =
        firstPage.advertisedTotal === null
          ? { isComplete: false }
          : resolveListingCompleteness(allListings.length, firstPage.advertisedTotal);
      const listingComplete =
        firstPage.advertisedTotal !== null &&
        failedPages.length === 0 &&
        !truncated &&
        countsComplete;
      if (allListings.length === 0) {
        if (firstPage.advertisedTotal === 0 && listingComplete) {
          return {
            outcome: "success",
            jobs: [],
            totalListings: 0,
            openExternalIds: [],
            listingCompleteness: "complete",
            detectedBoardToken: options?.boardToken ? undefined : companyId,
          };
        }
        return this.failure("parse_error", "TalentBrew returned no usable job listings.");
      }

      const openExternalIds = allListings.map((listing) =>
        this.externalId(companyId, listing.id)
      );
      const selection = selectListingsForHydration({
        listings: allListings,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (listing) => ({
          title: listing.title,
          location: listing.location,
        }),
        getExternalId: (listing) => this.externalId(companyId, listing.id),
      });
      const hydrated = await hydrateDetailsInBatches<
        TalentBrewListing,
        TalentBrewHydratedJob
      >({
        items: selection.listings,
        initialBatchSize: this.config.detailBatchSize,
        initialDelayMs: this.config.detailDelayMs,
        fetcher: (listing) => this.fetchDetail(companyId, listing),
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
            `TalentBrew listings were incomplete (${failedPages.length} failed page${failedPages.length === 1 ? "" : "s"}, ${allListings.length} of ${firstPage.advertisedTotal ?? "an unknown number of"} advertised jobs).`
          )
        );
      }
      if (detailFailures > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${detailFailures} TalentBrew detail request${detailFailures === 1 ? "" : "s"} could not be hydrated; listing data was retained.`
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
        detectedBoardToken: options?.boardToken ? undefined : companyId,
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private parsePage(html: string, pageUrl: string): TalentBrewPage {
    const $ = load(html);
    const metadata = $("[data-total-results], [data-total-pages]").first();
    const advertisedTotalValue = metadata.attr("data-total-results");
    const parsedAdvertisedTotal = advertisedTotalValue === undefined
      ? Number.NaN
      : Number(advertisedTotalValue);
    const advertisedTotal =
      Number.isFinite(parsedAdvertisedTotal) && parsedAdvertisedTotal >= 0
        ? parsedAdvertisedTotal
        : null;
    const totalPages = Math.max(1, Number(metadata.attr("data-total-pages") ?? 1));
    const ajaxPath = metadata.attr("data-ajax-url") || "/search-jobs/results";
    const recordsPerPage = Math.max(
      1,
      Number(metadata.attr("data-records-per-page") ?? 15)
    );
    let companyId =
      metadata.attr("data-company-id") ||
      $("[data-company-id]").first().attr("data-company-id") ||
      this.extractCompanyIdFromHtml(html);
    const listings = new Map<string, TalentBrewListing>();
    let candidateLinks = 0;

    $("a[href*='/job/']").each((_index, element) => {
      candidateLinks++;
      const href = $(element).attr("href");
      if (!href) return;
      let resolved: URL;
      try {
        resolved = new URL(href, pageUrl);
      } catch {
        return;
      }
      const segments = resolved.pathname.split("/").filter(Boolean);
      const id = [...segments].reverse().find((segment) => /^\d+$/u.test(segment));
      companyId ??= resolved.pathname.match(/\/job\/[^/]+\/[^/]+\/(\d+)\/\d+\/?$/iu)?.[1];
      const title = $(element)
        .find("h2, h3, [class*=title]")
        .first()
        .text()
        .replace(/\s+/gu, " ")
        .trim() || $(element).text().replace(/\s+/gu, " ").trim();
      if (!id || !title) return;
      const container = $(element).closest("li, article, [class*=job]");
      const location = container
        .find("[class*=location]")
        .first()
        .text()
        .replace(/\s+/gu, " ")
        .trim();
      listings.set(id, {
        id,
        title,
        url: resolved.toString(),
        location: location || undefined,
      });
    });

    return {
      listings: Array.from(listings.values()),
      invalidListings: Math.max(0, candidateLinks - listings.size),
      totalPages: Number.isFinite(totalPages) ? totalPages : 1,
      advertisedTotal,
      ajaxPath,
      companyId,
      recordsPerPage: Number.isFinite(recordsPerPage) ? recordsPerPage : 15,
    };
  }

  private setPaginationParams(url: URL, page: number, recordsPerPage: number): void {
    const values: Record<string, string> = {
      ActiveFacetID: "0",
      CurrentPage: String(page),
      RecordsPerPage: String(recordsPerPage),
      TotalContentResults: "",
      Distance: "50",
      RadiusUnitType: "0",
      Keywords: "",
      Location: "",
      ShowRadius: "False",
      IsPagination: "False",
      CustomFacetName: "",
      FacetTerm: "",
      FacetType: "0",
      SearchResultsModuleName: "Search Results",
      SearchFiltersModuleName: "Search Filters",
      SortCriteria: "0",
      SortDirection: "0",
      SearchType: "5",
      PostalCode: "",
      ResultsType: "0",
      fc: "",
      fl: "",
      fcf: "",
      afc: "",
      afl: "",
      afcf: "",
    };
    for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  }

  private extractCompanyIdFromHtml(html: string): string | undefined {
    return html.match(/(?:companyId|company-id)["':=\s]+([0-9]{2,})/iu)?.[1];
  }

  private extractAjaxResults(body: string): string {
    const trimmed = body.trim();
    if (!trimmed.startsWith("{")) return body;
    try {
      const payload = JSON.parse(trimmed) as Record<string, unknown>;
      return typeof payload.results === "string" ? payload.results : body;
    } catch {
      return body;
    }
  }

  private async fetchDetail(
    companyId: string,
    listing: TalentBrewListing
  ): Promise<TalentBrewHydratedJob> {
    const fallback = this.mapListingToJob(companyId, listing);
    try {
      const response = await this.fetchResponse(listing.url, {
        headers: this.htmlRequestHeaders(),
      });
      if (!response.ok) return { job: fallback, failed: true };
      const $ = load(await response.text());
      const title = $("h1").first().text().replace(/\s+/gu, " ").trim() || listing.title;
      const descriptionElement = $(
        "[class*=job-description], [data-job-description], .job-description"
      ).first();
      const rawDescription = descriptionElement.html()?.trim() || "";
      const processed = rawDescription
        ? processDescription(
            rawDescription,
            containsHtml(rawDescription) ? "html" : "plain"
          )
        : null;
      const location = $("[class*=job-location], [class*=location]")
        .first()
        .text()
        .replace(/\s+/gu, " ")
        .trim() || listing.location;
      const department = $("[class*=category], [data-job-category]")
        .first()
        .text()
        .replace(/\s+/gu, " ")
        .trim();
      const normalizedLocation = this.normalizeLocation(location ?? "");

      return {
        failed: !processed?.text,
        job: {
          ...fallback,
          title,
          location: normalizedLocation.location,
          locationType: normalizedLocation.locationType,
          department: department || undefined,
          description: processed?.text ?? undefined,
          descriptionFormat: processed?.format,
        },
      };
    } catch (error) {
      throwIfScrapeAborted(error);
      return { job: fallback, failed: true };
    }
  }

  private mapListingToJob(companyId: string, listing: TalentBrewListing): ScrapedJob {
    const normalizedLocation = this.normalizeLocation(listing.location ?? "");
    return {
      externalId: this.externalId(companyId, listing.id),
      title: listing.title,
      url: listing.url,
      location: normalizedLocation.location,
      locationType: normalizedLocation.locationType,
    };
  }

  private externalId(companyId: string, jobId: string): string {
    return this.generateExternalId(this.platform, companyId, jobId);
  }
}
