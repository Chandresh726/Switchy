import { load } from "cheerio";

import {
  containsHtml,
  processDescription,
} from "@/lib/jobs/description-processor";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import { matchesPreferredCountry } from "@/lib/scraper/services/filter-service";
import { HttpError, type IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { createScraperError } from "@/lib/scraper/types";

import type { ListingQueryOptimizer } from "./shared/query-optimizer";
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

  constructor(httpClient: IHttpClient, config: Partial<TalentBrewConfig> = {}, private readonly queries?: ListingQueryOptimizer) {
    super(httpClient, { ...DEFAULT_TALENTBREW_CONFIG, ...config });
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

      const firstHtml = await firstResponse.text();
      const firstPage = this.parsePage(firstHtml, searchUrl.toString());
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

      const policy = this.queries?.policy(this.platform, url, companyId);
      const pageSize = Number.isFinite(policy?.pageSize) ? Math.min(100, Math.max(1, Math.floor(policy!.pageSize!))) : 100;
      const $ = load(firstHtml);
      const countries = $("input[data-facet-type='2'][data-id][data-display]").toArray().map((element) => ({
        id: $(element).attr("data-id")!, label: $(element).attr("data-display")!,
      }));
      const country = policy?.countryFilter && !source.search ? options?.filters?.country : undefined;
      const selected = country ? countries.filter((facet) => matchesPreferredCountry(facet.label, country)) : [];
      const effectiveCountry = selected.length ? country : undefined;
      const baseline = async () => {
        const value = await this.fetchListingPages(firstPage, source.origin);
        return { value, items: value.listings, complete: value.complete, advertisedTotal: value.page.advertisedTotal };
      };
      const chosen = this.queries && !source.search ? await this.queries.fetch({
        platform: this.platform, source: url, board: companyId, country: effectiveCountry,
        candidateKey: { pageSize, countries, selected, version: 1 }, baseline,
        candidate: async () => {
          const page = await this.fetchAjaxPage(firstPage.ajaxPath, source.origin, 1, pageSize, selected);
          const value = await this.fetchListingPages(page, source.origin, selected);
          return { value, items: value.listings, complete: value.complete, advertisedTotal: page.advertisedTotal };
        },
        getId: (listing) => listing.id, toFilterable: (listing) => listing,
      }) : { value: (await baseline()).value, listingScopeKey: undefined };
      const { listings: allListings, complete: listingComplete, failedPages, page: listingPage } = chosen.value;
      const listingScopeKey = chosen.listingScopeKey;
      if (allListings.length === 0) {
        if (listingPage.advertisedTotal === 0 && listingComplete) {
          return {
            outcome: "success",
            jobs: [],
            totalListings: 0,
            openExternalIds: [],
            listingScopeKey,
            listingCompleteness: "complete",
            detectedBoardToken: options?.boardToken ? undefined : companyId,
          };
        }
        return this.failure("parse_error", "TalentBrew returned no usable job listings.");
      }

      const openExternalIds = allListings.map((listing) =>
        this.externalId(companyId, listing.id)
      );
      const listingJobs: ScrapedJob[] = allListings.map((item) => this.mapListingToJob(companyId, item));
      const selection = selectListingsForHydration({
        listings: allListings,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        detailRefresh: options?.detailRefresh,
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
      const issues = [...hydrated.issues];
      if (!listingComplete) {
        issues.push(
          createScraperError(
            "network_error",
            `TalentBrew listings were incomplete (${failedPages.length} failed page${failedPages.length === 1 ? "" : "s"}, ${allListings.length} of ${listingPage.advertisedTotal ?? "an unknown number of"} advertised jobs).`
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
        listingJobs,
        totalListings: allListings.length,
        advertisedTotal: listingPage.advertisedTotal,
        openExternalIds,
        listingScopeKey,
        listingCompleteness: listingComplete ? "complete" : "partial",
        earlyFiltered: selection.earlyFiltered,
        detectedBoardToken: options?.boardToken ? undefined : companyId,
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private async fetchAjaxPage(path: string, origin: string, page: number, size: number, facets: Array<{ id: string; label: string }> = []): Promise<TalentBrewPage> {
    const url = new URL(path, origin);
    this.setPaginationParams(url, page, size);
    facets.forEach((facet, index) => {
      url.searchParams.set(`FacetFilters[${index}].ID`, facet.id);
      url.searchParams.set(`FacetFilters[${index}].FacetType`, "2");
      url.searchParams.set(`FacetFilters[${index}].Display`, facet.label);
      url.searchParams.set(`FacetFilters[${index}].IsApplied`, "true");
    });
    const response = await this.fetchResponse(url.toString(), {
      headers: this.htmlRequestHeaders({ "X-Requested-With": "XMLHttpRequest" }),
    });
    if (!response.ok) throw new HttpError(response.status, "TalentBrew listing request failed", url.toString(), response.headers);
    return this.parsePage(this.extractAjaxResults(await response.text()), url.toString());
  }

  private async fetchListingPages(firstPage: TalentBrewPage, origin: string, facets: Array<{ id: string; label: string }> = []) {
    const listings = new Map(firstPage.listings.map((listing) => [listing.id, listing]));
    const failedPages: number[] = [];
    let invalid = firstPage.invalidListings;
    let inconsistent = false;
    const count = Math.min(firstPage.totalPages, this.config.maxListingPages);
    const fingerprints = new Set([JSON.stringify(firstPage.listings.map((item) => item.id).sort())]);
    for (let page = 2; page <= count; page++) {
      try {
        const result = await this.fetchAjaxPage(firstPage.ajaxPath, origin, page, firstPage.recordsPerPage, facets);
        const fingerprint = JSON.stringify(result.listings.map((item) => item.id).sort());
        if (result.listings.length && fingerprints.has(fingerprint)) { failedPages.push(page); break; }
        fingerprints.add(fingerprint);
        invalid += result.invalidListings;
        if (result.advertisedTotal !== firstPage.advertisedTotal) inconsistent = true;
        for (const listing of result.listings) listings.set(listing.id, listing);
      } catch (error) {
        throwIfScrapeAborted(error);
        if (error instanceof HttpError && (error.status === 429 || error.isBrowserChallenge)) throw error;
        failedPages.push(page);
      }
    }
    const items = [...listings.values()];
    const complete = firstPage.advertisedTotal !== null && failedPages.length === 0 && !invalid && !inconsistent &&
      firstPage.totalPages <= this.config.maxListingPages && items.length >= firstPage.advertisedTotal;
    return { listings: items, complete, failedPages, page: firstPage };
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
