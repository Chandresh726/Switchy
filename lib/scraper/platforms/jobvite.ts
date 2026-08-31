import { load, type CheerioAPI } from "cheerio";

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
} from "@/lib/scraper/types";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type {
  ApiScraperConfig,
  ScrapedJob,
  ScrapeOptions,
  ScraperResult,
} from "../core/types";
import { hydrateDetailsInBatches } from "./shared/detail-hydrator";
import { selectListingsForHydration } from "./shared/listing-selection";

interface JobviteListing {
  opaqueId: string;
  title: string;
  url: string;
  location?: string;
}

interface JobviteHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

interface JobviteDetailMetadata {
  requisition?: string;
  location?: string;
  category?: string;
  jobType?: string;
}

interface JobvitePage {
  html: string;
  status?: number;
  unavailable: boolean;
}

export type JobviteConfig = ApiScraperConfig & {
  maxListingPages: number;
  detailBatchSize: number;
  detailDelayMs: number;
  unavailableRetries: number;
  unavailableRetryDelayMs: number;
};

const DEFAULT_JOBVITE_CONFIG: JobviteConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://jobs.jobvite.com",
  timeout: 60_000,
  maxListingPages: 100,
  detailBatchSize: 5,
  detailDelayMs: 200,
  unavailableRetries: 2,
  unavailableRetryDelayMs: 500,
};

const JOBVITE_DESCRIPTION_SELECTORS = [
  "#jv-job-detail-description",
  ".jv-job-detail-description-body",
  ".jv-job-detail-description",
] as const;

export class JobviteScraper extends AbstractApiScraper<JobviteConfig> {
  readonly platform = "jobvite" as const;

  constructor(httpClient: IHttpClient, config: Partial<JobviteConfig> = {}) {
    super(httpClient, { ...DEFAULT_JOBVITE_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const parsed = this.parseSourceUrl(url);
    if (!parsed) return false;
    const hostname = parsed.hostname.toLowerCase();
    return hostname === "jobs.jobvite.com" || hostname === "careers.nutanix.com";
  }

  extractIdentifier(url: string): string | null {
    const parsed = this.parseSourceUrl(url);
    if (!parsed) return null;
    if (parsed.hostname.toLowerCase() === "careers.nutanix.com") return "nutanix";
    if (parsed.hostname.toLowerCase() !== "jobs.jobvite.com") return null;
    return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const slug = options?.boardToken?.trim() || this.extractIdentifier(url);
      if (!slug || !/^[a-z0-9_-]+$/iu.test(slug)) {
        return this.failure(
          "invalid_url",
          "Jobvite URL or board token must identify a valid company slug."
        );
      }

      const listingResult = await this.fetchListings(slug);
      if (listingResult.listings.length === 0) {
        if (listingResult.firstStatus) {
          return this.failureForHttpStatus(
            listingResult.firstStatus,
            `Failed to fetch Jobvite board ${slug}.`
          );
        }
        if (listingResult.unavailable) {
          return this.failure(
            "network_error",
            `Jobvite board ${slug} is temporarily unavailable.`
          );
        }
        if (listingResult.isComplete) {
          return {
            outcome: "success",
            jobs: [],
            totalListings: 0,
            openExternalIds: [],
            listingCompleteness: "complete",
            detectedBoardToken: options?.boardToken ? undefined : slug,
          };
        }
        return this.failure("parse_error", `Jobvite board ${slug} returned no usable jobs.`);
      }

      const hydrated = await hydrateDetailsInBatches<
        JobviteListing,
        JobviteHydratedJob
      >({
        items: listingResult.listings,
        initialBatchSize: this.config.detailBatchSize,
        initialDelayMs: this.config.detailDelayMs,
        fetcher: (listing) => this.fetchJobDetail(slug, listing),
      });
      let detailFailures = hydrated.failures;
      const allJobs = hydrated.results.flatMap((result) => {
        if (result.failed) {
          detailFailures++;
          return [];
        }
        return [result.job];
      });
      const selection = selectListingsForHydration({
        listings: allJobs,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (job) => ({ title: job.title, location: job.location }),
        getExternalId: (job) => job.externalId,
      });
      const isComplete = listingResult.isComplete && detailFailures === 0;
      const issues = [];
      if (!listingResult.isComplete) {
        issues.push(
          createScraperError(
            "network_error",
            `Jobvite listings were incomplete (${listingResult.failedPages.length} failed page${listingResult.failedPages.length === 1 ? "" : "s"}, ${listingResult.invalidListings} malformed listing${listingResult.invalidListings === 1 ? "" : "s"}).`
          )
        );
      }
      if (detailFailures > 0) {
        issues.push(
          createScraperError(
            "network_error",
            `${detailFailures} Jobvite detail request${detailFailures === 1 ? "" : "s"} could not be fully hydrated.`
          )
        );
      }

      return {
        outcome: isComplete ? "success" : "partial",
        jobs: selection.listings,
        totalListings: listingResult.listings.length,
        openExternalIds: allJobs.map((job) => job.externalId),
        listingCompleteness: isComplete ? "complete" : "partial",
        earlyFiltered: selection.earlyFiltered,
        detectedBoardToken: options?.boardToken ? undefined : slug,
        issues: issues.length > 0 ? issues : undefined,
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private async fetchListings(slug: string): Promise<{
    listings: JobviteListing[];
    failedPages: number[];
    firstStatus?: number;
    unavailable: boolean;
    isComplete: boolean;
    invalidListings: number;
  }> {
    const listings = new Map<string, JobviteListing>();
    const failedPages: number[] = [];
    let invalidListings = 0;
    let unavailable = false;
    const boardUrl = new URL(`/${slug}/jobs`, this.config.baseUrl).toString();
    let parsedBoard: ReturnType<JobviteScraper["parseListingPage"]> | undefined;
    for (let attempt = 0; attempt <= this.config.unavailableRetries; attempt++) {
      const boardPage = await this.fetchJobvitePage(boardUrl);
      if (boardPage.status || boardPage.unavailable) {
        return {
          listings: [],
          failedPages: [0],
          firstStatus: boardPage.status,
          unavailable: boardPage.unavailable,
          isComplete: false,
          invalidListings,
        };
      }
      parsedBoard = this.parseListingPage(boardPage.html, slug, boardUrl);
      if (parsedBoard.listings.length > 0 || parsedBoard.advertisedZero) break;
      if (attempt < this.config.unavailableRetries) {
        await abortableDelay(this.config.unavailableRetryDelayMs);
      }
    }
    if (!parsedBoard || (parsedBoard.listings.length === 0 && !parsedBoard.advertisedZero)) {
      return {
        listings: [],
        failedPages: [0],
        unavailable: true,
        isComplete: false,
        invalidListings,
      };
    }
    invalidListings += parsedBoard.invalidListings;
    for (const listing of parsedBoard.listings) listings.set(listing.opaqueId, listing);

    let discoveredMaxPage = parsedBoard.maxPage;
    for (
      let page = 0;
      discoveredMaxPage !== null &&
        page <= discoveredMaxPage &&
        page < this.config.maxListingPages;
      page++
    ) {
      const pageUrl = new URL(`/${slug}/search/`, this.config.baseUrl);
      pageUrl.searchParams.set("p", String(page));
      const result = await this.fetchJobvitePage(pageUrl.toString());
      if (result.status || result.unavailable) {
        failedPages.push(page);
        unavailable ||= result.unavailable;
        continue;
      }

      const parsed = this.parseListingPage(result.html, slug, pageUrl.toString());
      invalidListings += parsed.invalidListings;
      for (const listing of parsed.listings) listings.set(listing.opaqueId, listing);
      if (parsed.maxPage !== null) {
        discoveredMaxPage = Math.max(discoveredMaxPage, parsed.maxPage);
      }
    }

    const truncated =
      discoveredMaxPage !== null && discoveredMaxPage >= this.config.maxListingPages;
    return {
      listings: Array.from(listings.values()),
      failedPages,
      unavailable,
      isComplete: failedPages.length === 0 && invalidListings === 0 && !truncated,
      invalidListings,
    };
  }

  private async fetchJobvitePage(url: string): Promise<JobvitePage> {
    for (let attempt = 0; attempt <= this.config.unavailableRetries; attempt++) {
      const response = await this.fetchResponse(url, {
        headers: this.htmlRequestHeaders(),
      });
      if (!response.ok) return { html: "", status: response.status, unavailable: false };
      const html = await response.text();
      if (!this.isUnavailablePage(html)) return { html, unavailable: false };
      if (attempt < this.config.unavailableRetries) {
        await abortableDelay(this.config.unavailableRetryDelayMs);
      }
    }
    return { html: "", unavailable: true };
  }

  private isUnavailablePage(html: string): boolean {
    const normalized = html.toLowerCase();
    return (
      normalized.includes("/careers/info/unavailable.html") ||
      normalized.includes("career site is currently unavailable") ||
      normalized.includes("careers site is currently unavailable")
    );
  }

  private parseListingPage(html: string, slug: string, pageUrl: string): {
    listings: JobviteListing[];
    maxPage: number | null;
    advertisedZero: boolean;
    invalidListings: number;
  } {
    const $ = load(html);
    const listings = new Map<string, JobviteListing>();
    let maxPage: number | null = null;
    const candidateJobIds = new Set<string>();

    $("a[href]").each((_index, element) => {
      const href = $(element).attr("href");
      if (!href) return;
      let resolved: URL;
      try {
        resolved = new URL(href, pageUrl);
      } catch {
        return;
      }

      const jobMatch = resolved.pathname.match(
        new RegExp(`^/${this.escapeRegExp(slug)}/job/([^/]+)/?$`, "iu")
      );
      if (jobMatch?.[1]) {
        candidateJobIds.add(jobMatch[1]);
        const title = $(element).text().replace(/\s+/gu, " ").trim();
        if (!title) return;
        const container = $(element).closest("tr, .jv-job-list-row, .jv-featured-job");
        const location = container
          .find(".jv-job-list-location, .jv-featured-job-location, td")
          .last()
          .text()
          .replace(/\s+/gu, " ")
          .trim();
        listings.set(jobMatch[1], {
          opaqueId: jobMatch[1],
          title,
          url: resolved.toString(),
          location: location || undefined,
        });
      }

      if (resolved.pathname.includes(`/${slug}/search`)) {
        const page = Number.parseInt(resolved.searchParams.get("p") ?? "", 10);
        if (!Number.isNaN(page)) maxPage = Math.max(maxPage ?? page, page);
      }
    });

    const emptyMessage = $(
      ".jv-page-message, .jv-job-list-empty, .jv-search-no-results, [class*=no-results]"
    )
      .text()
      .replace(/\s+/gu, " ")
      .trim();
    const advertisedZero =
      listings.size === 0 &&
      /(?:no (?:open )?(?:positions|jobs)|no results|0 (?:positions|jobs))/iu.test(
        emptyMessage
      );

    return {
      listings: Array.from(listings.values()),
      maxPage,
      advertisedZero,
      invalidListings: Array.from(candidateJobIds).filter((id) => !listings.has(id)).length,
    };
  }

  private async fetchJobDetail(
    slug: string,
    listing: JobviteListing
  ): Promise<JobviteHydratedJob> {
    const fallback = this.mapListingToJob(slug, listing, listing.opaqueId);
    let lastJob = fallback;
    for (let attempt = 0; attempt <= this.config.unavailableRetries; attempt++) {
      try {
        const page = await this.fetchJobvitePage(listing.url);
        if (page.status || page.unavailable) {
          return { job: lastJob, failed: true };
        }
        const $ = load(page.html);
        const bodyText = $("body").text().replace(/\s+/gu, " ").trim();
        const metadata = this.extractDetailMetadata($, bodyText, listing.location);
        const title =
          $(".jv-job-detail-title, .jv-header")
            .first()
            .text()
            .replace(/\s+/gu, " ")
            .trim() ||
          $("h1").first().text().replace(/\s+/gu, " ").trim() ||
          listing.title;
        const rawDescription = this.extractDescriptionHtml($);
        const processed = rawDescription
          ? processDescription(
              rawDescription,
              containsHtml(rawDescription) ? "html" : "plain"
            )
          : null;
        const normalizedLocation = this.normalizeLocation(metadata.location ?? "");
        lastJob = {
          externalId: this.generateExternalId(
            this.platform,
            slug,
            metadata.requisition || listing.opaqueId
          ),
          title,
          url: listing.url,
          location: normalizedLocation.location,
          locationType: normalizedLocation.locationType,
          department: metadata.category,
          employmentType: parseEmploymentType(metadata.jobType),
          description: processed?.text ?? undefined,
          descriptionFormat: processed?.format,
        };
        if (processed?.text) return { job: lastJob, failed: false };
      } catch (error) {
        throwIfScrapeAborted(error);
        return { job: lastJob, failed: true };
      }
      if (attempt < this.config.unavailableRetries) {
        await abortableDelay(this.config.unavailableRetryDelayMs);
      }
    }
    return { job: lastJob, failed: true };
  }

  private extractDetailMetadata(
    $: CheerioAPI,
    bodyText: string,
    fallbackLocation?: string
  ): JobviteDetailMetadata {
    const metaElement = $(".jv-job-detail-meta").first();
    const metaText = metaElement.text().replace(/\s+/gu, " ").trim();
    const segmentedMeta = metaElement.clone();
    segmentedMeta.find(".jv-inline-separator").replaceWith("|");
    const metaParts = segmentedMeta
      .text()
      .split("|")
      .map((part) => part.replace(/\s+/gu, " ").trim())
      .filter(Boolean);
    const explicitLocation = $(".jv-job-detail-location")
      .first()
      .text()
      .replace(/\s+/gu, " ")
      .replace(/^Location\s*:?\s*/iu, "")
      .trim();
    const requisitionPattern = /\bReq\.\s*Num\.\s*:?\s*([A-Za-z0-9_-]+)/iu;
    const categoryPattern = /\bCategory\s*:\s*(.+?)(?=\s+(?:Job Type|Req\.)\s*:|$)/iu;
    const jobTypePattern = /\bJob Type\s*:\s*(.+?)(?=\s+Req\.\s*:|$)/iu;
    const category =
      metaText.match(categoryPattern)?.[1]?.trim() ||
      bodyText.match(categoryPattern)?.[1]?.trim();
    const jobType =
      metaText.match(jobTypePattern)?.[1]?.trim() ||
      bodyText.match(jobTypePattern)?.[1]?.trim();
    const unlabeledParts = metaParts.filter(
      (part) =>
        !requisitionPattern.test(part) &&
        !categoryPattern.test(part) &&
        !jobTypePattern.test(part)
    );
    const impliedCategory =
      category ||
      (unlabeledParts.length >= 2 || explicitLocation
        ? unlabeledParts[0]
        : undefined);
    const impliedLocation =
      explicitLocation ||
      (unlabeledParts.length >= 2
        ? unlabeledParts.at(-1)
        : fallbackLocation);

    return {
      requisition:
        metaText.match(requisitionPattern)?.[1] ||
        bodyText.match(requisitionPattern)?.[1],
      location: impliedLocation,
      category: impliedCategory,
      jobType,
    };
  }

  private extractDescriptionHtml($: CheerioAPI): string {
    for (const selector of JOBVITE_DESCRIPTION_SELECTORS) {
      const candidate = $(selector).first();
      if (candidate.length > 0) return this.cleanDescriptionElement(candidate);
    }

    const genericCandidates = $("[class*=job-description]").toArray();
    const innermostCandidate = genericCandidates.find(
      (candidate) => $(candidate).find("[class*=job-description]").length === 0
    );
    if (!innermostCandidate) return "";

    return this.cleanDescriptionElement($(innermostCandidate));
  }

  private cleanDescriptionElement(
    candidate: ReturnType<CheerioAPI>
  ): string {
    const cleaned = candidate.clone();
    cleaned.find("script, style, noscript, template, nav, footer").remove();
    const html = cleaned.html()?.trim() || "";
    return this.hasPageChromeContamination(html) ? "" : html;
  }

  private hasPageChromeContamination(html: string): boolean {
    const normalized = html.toLowerCase();
    return (
      normalized.includes("jv_common_directives_") ||
      normalized.includes("document.write(new date().getfullyear())") ||
      (normalized.includes("jquery(") && normalized.includes("scrolltop"))
    );
  }

  private mapListingToJob(
    slug: string,
    listing: JobviteListing,
    identity: string
  ): ScrapedJob {
    const normalizedLocation = this.normalizeLocation(listing.location ?? "");
    return {
      externalId: this.generateExternalId(this.platform, slug, identity),
      title: listing.title,
      url: listing.url,
      location: normalizedLocation.location,
      locationType: normalizedLocation.locationType,
    };
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
}
