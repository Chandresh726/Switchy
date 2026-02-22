import { load, type CheerioAPI } from "cheerio";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig, EarlyFilterStats, SeniorityLevel } from "@/lib/scraper/types";
import { applyEarlyFilters, hasEarlyFilters, toEarlyFilterStats } from "@/lib/scraper/services";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import { hydrateDetailsInBatches } from "./shared/detail-hydrator";
import { fetchPaginatedHtmlByPageParam, resolveUrl } from "./shared/html-pagination";
import { normalizeDescription } from "./shared/job-normalizers";

interface GoogleListingJob {
  id: string;
  slug: string;
  url: string;
  title: string;
  location?: string;
  seniority?: SeniorityLevel;
}

interface GoogleJobPostingJsonLd {
  description?: string;
  title?: string;
}

interface GoogleHydratedJob {
  job: ScrapedJob;
  failed: boolean;
}

export type GoogleConfig = ApiScraperConfig & {
  detailBatchSize: number;
  detailDelayMs: number;
  maxPages: number;
};

export const DEFAULT_GOOGLE_CONFIG: GoogleConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://www.google.com",
  detailBatchSize: 4,
  detailDelayMs: 500,
  maxPages: 30,
};

export class GoogleScraper extends AbstractApiScraper<GoogleConfig> {
  readonly platform = "google" as const;

  constructor(httpClient: IHttpClient, config: Partial<GoogleConfig> = {}) {
    super(httpClient, { ...DEFAULT_GOOGLE_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes("google.com/about/careers/applications/jobs") ||
      lower.includes("google.com/about/careers") ||
      lower.includes("careers.google.com")
    );
  }

  extractIdentifier(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.includes("/jobs/results")) {
        return "jobs";
      }
      return null;
    } catch {
      return null;
    }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const listingUrl = this.resolveListingUrl(url);
      const pagedResult = await fetchPaginatedHtmlByPageParam({
        httpClient: this.httpClient,
        startUrl: listingUrl,
        headers: this.createHtmlHeaders(),
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
        maxPages: this.config.maxPages,
      });

      if (pagedResult.pages.length === 0) {
        return {
          success: false,
          outcome: "error",
          jobs: [],
          openExternalIds: [],
          openExternalIdsComplete: false,
          error: "Failed to fetch Google Careers listing pages.",
        };
      }

      const discoveredListings = this.extractListingsFromPages(
        pagedResult.pages.map((page) => page.html),
        listingUrl
      );
      const listings = this.dedupeListings(discoveredListings);
      const openExternalIds = listings.map((listing) =>
        this.generateExternalId(this.platform, listing.id)
      );

      if (listings.length === 0) {
        const outcome = pagedResult.isComplete ? "success" : "error";
        return {
          success: outcome !== "error",
          outcome,
          jobs: [],
          openExternalIds,
          openExternalIdsComplete: pagedResult.isComplete,
          error: outcome === "error" ? "Incomplete Google list fetch with no usable jobs." : undefined,
        };
      }

      const filters = options?.filters;
      const existingExternalIds = options?.existingExternalIds;
      let jobsToProcess = listings;
      let earlyFilterStats: EarlyFilterStats | undefined;

      if (hasEarlyFilters(filters)) {
        const earlyFilterResult = applyEarlyFilters(
          listings.map((job) => ({
            ...job,
            title: job.title,
            location: job.location || "",
          })),
          filters
        );
        jobsToProcess = earlyFilterResult.filtered as GoogleListingJob[];
        earlyFilterStats = toEarlyFilterStats(earlyFilterResult);
      }

      if (jobsToProcess.length === 0) {
        return {
          success: true,
          outcome: pagedResult.isComplete ? "success" : "partial",
          jobs: [],
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          openExternalIdsComplete: pagedResult.isComplete,
        };
      }

      const jobsToFetch = existingExternalIds
        ? jobsToProcess.filter((job) => {
            const externalId = this.generateExternalId(this.platform, job.id);
            return !existingExternalIds.has(externalId);
          })
        : jobsToProcess;

      if (jobsToFetch.length === 0) {
        return {
          success: true,
          outcome: pagedResult.isComplete ? "success" : "partial",
          jobs: [],
          earlyFiltered: earlyFilterStats,
          openExternalIds,
          openExternalIdsComplete: pagedResult.isComplete,
        };
      }

      const hydrated = await hydrateDetailsInBatches<GoogleListingJob, GoogleHydratedJob>({
        items: jobsToFetch,
        initialBatchSize: this.config.detailBatchSize,
        initialDelayMs: this.config.detailDelayMs,
        fetcher: async (job) => this.fetchAndHydrateJob(job),
      });

      let detailFailures = hydrated.failures;
      const scrapedJobs = hydrated.results.map((result) => {
        if (result.failed) detailFailures++;
        return result.job;
      });

      const outcome = detailFailures > 0 || !pagedResult.isComplete ? "partial" : "success";

      return {
        success: true,
        outcome,
        jobs: scrapedJobs,
        earlyFiltered: earlyFilterStats,
        openExternalIds,
        openExternalIdsComplete: pagedResult.isComplete,
      };
    } catch (error) {
      return {
        success: false,
        outcome: "error",
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private resolveListingUrl(url: string): string {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.toLowerCase().replace(/\/+$/, "");

    if (normalizedPath.includes("/jobs/results/")) {
      parsed.pathname = "/about/careers/applications/jobs/results";
    } else if (!normalizedPath.includes("/about/careers/applications/jobs/results")) {
      parsed.pathname = "/about/careers/applications/jobs/results";
    }

    if (parsed.hostname === "careers.google.com") {
      parsed.hostname = "www.google.com";
    }

    return parsed.toString();
  }

  private extractListingsFromPages(pages: string[], listingUrl: string): GoogleListingJob[] {
    const listings: GoogleListingJob[] = [];

    for (const html of pages) {
      const $ = load(html);
      $("a[href]").each((_idx, anchor) => {
        const href = $(anchor).attr("href");
        if (!href) return;

        const resolved = this.resolveGoogleJobUrl(listingUrl, href);
        const parsed = this.parseJobUrl(resolved);
        if (!parsed) return;

        const card = this.resolveCardContainer($, anchor);
        const title =
          card.find("h1, h2, h3").first().text().trim() ||
          $(anchor).text().trim() ||
          parsed.slug.replace(/-/g, " ");

        const cardTexts = [
          ...card.find("p, li, span, div").map((_i, el) => $(el).text().trim()).get(),
        ].filter(Boolean);

        const location = this.extractLocation(cardTexts);
        const seniority = this.extractSeniority(cardTexts.join(" "));

        listings.push({
          id: parsed.id,
          slug: parsed.slug,
          url: resolved,
          title,
          location,
          seniority,
        });
      });
    }

    return listings;
  }

  private resolveGoogleJobUrl(listingUrl: string, href: string): string {
    const trimmed = href.trim();
    if (!trimmed) return trimmed;

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    // Google careers often uses relative paths like "jobs/results/<id>-<slug>".
    // Resolving those against ".../jobs/results" creates malformed nested URLs.
    if (/^\.?\/?jobs\/results\//i.test(trimmed)) {
      const listing = new URL(listingUrl);
      const normalized = trimmed.replace(/^\.?\//, "").replace(/^\/+/, "");
      return `${listing.origin}/about/careers/applications/${normalized}`;
    }

    return resolveUrl(listingUrl, trimmed);
  }

  private resolveCardContainer($: CheerioAPI, anchor: Parameters<CheerioAPI>[0]) {
    const selected = $(anchor).closest("li, [role='listitem'], article, .search-result, .jobs-result");
    if (selected.length > 0) {
      return selected;
    }
    return $(anchor).parent();
  }

  private parseJobUrl(url: string): { id: string; slug: string } | null {
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/\/jobs\/results\/(\d+)-([^\/?#]+)/i);
      if (!match) return null;
      return { id: match[1], slug: match[2] };
    } catch {
      return null;
    }
  }

  private dedupeListings(listings: GoogleListingJob[]): GoogleListingJob[] {
    const deduped = new Map<string, GoogleListingJob>();

    for (const listing of listings) {
      const existing = deduped.get(listing.id);
      if (!existing) {
        deduped.set(listing.id, listing);
        continue;
      }

      if (!existing.location && listing.location) {
        existing.location = listing.location;
      }
      if (!existing.seniority && listing.seniority) {
        existing.seniority = listing.seniority;
      }
      if (!existing.title && listing.title) {
        existing.title = listing.title;
      }
    }

    return Array.from(deduped.values());
  }

  private extractLocation(values: string[]): string | undefined {
    for (const value of values) {
      const normalized = value.replace(/\s+/g, " ").trim();
      if (!normalized) continue;
      if (normalized.length < 3 || normalized.length > 120) continue;
      if (/(minimum qualifications|preferred qualifications|learn more|apply|share)/i.test(normalized)) {
        continue;
      }
      if (/(india|united states|united kingdom|canada|germany|france|remote|hyderabad|bengaluru|bangalore|pune|mumbai)/i.test(normalized)) {
        return normalized;
      }
    }
    return undefined;
  }

  private extractSeniority(text: string): SeniorityLevel | undefined {
    const lower = text.toLowerCase();
    if (lower.includes("entry") || lower.includes("early")) return "entry";
    if (lower.includes("mid")) return "mid";
    if (lower.includes("senior")) return "senior";
    if (lower.includes("lead")) return "lead";
    if (lower.includes("manager") || lower.includes("director")) return "manager";
    return undefined;
  }

  private async fetchAndHydrateJob(listing: GoogleListingJob): Promise<GoogleHydratedJob> {
    const fallback = this.mapListingToJob(listing);

    const response = await this.httpClient.fetch(listing.url, {
      timeout: this.config.timeout,
      retries: this.config.retries,
      baseDelay: this.config.baseDelay,
      headers: this.createHtmlHeaders(),
    });

    if (!response.ok) {
      return { job: fallback, failed: true };
    }

    const html = await response.text();
    const $ = load(html);
    const jsonLd = this.extractJobPostingJsonLd($);
    const sectionHtml = this.extractDetailSectionHtml($);
    const { description, descriptionFormat } = normalizeDescription(
      jsonLd?.description || sectionHtml
    );
    const detailTitle =
      jsonLd?.title || $("main h2").first().text().trim() || $("h1").first().text().trim();
    const normalizedLocation = this.normalizeLocation(listing.location || "");

    return {
      failed: false,
      job: {
        externalId: this.generateExternalId(this.platform, listing.id),
        title: detailTitle || listing.title,
        url: listing.url,
        location: normalizedLocation.location,
        locationType: normalizedLocation.locationType,
        description,
        descriptionFormat,
        seniorityLevel: listing.seniority,
      },
    };
  }

  private mapListingToJob(listing: GoogleListingJob): ScrapedJob {
    const normalizedLocation = this.normalizeLocation(listing.location || "");
    return {
      externalId: this.generateExternalId(this.platform, listing.id),
      title: listing.title,
      url: listing.url,
      location: normalizedLocation.location,
      locationType: normalizedLocation.locationType,
      seniorityLevel: listing.seniority,
    };
  }

  private extractDetailSectionHtml($: CheerioAPI): string {
    const headingRegex =
      /minimum qualifications|preferred qualifications|about the job|responsibilities/i;
    const headings = $("h2, h3")
      .filter((_idx, el) => headingRegex.test($(el).text().trim()))
      .toArray();

    if (headings.length === 0) {
      return $("main").first().html() || "";
    }

    const sections: string[] = [];
    for (const heading of headings) {
      const headingEl = $(heading);
      const headingHtml = $.html(headingEl);
      const bodyHtml = headingEl.nextUntil("h2, h3").toArray().map((node) => $.html(node)).join("\n");
      sections.push(`${headingHtml}\n${bodyHtml}`);
    }

    return sections.join("\n");
  }

  private extractJobPostingJsonLd($: CheerioAPI): GoogleJobPostingJsonLd | undefined {
    const scripts = $('script[type="application/ld+json"]').toArray();

    for (const script of scripts) {
      const raw = $(script).text().trim();
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw) as unknown;

        if (
          parsed &&
          typeof parsed === "object" &&
          (parsed as { "@type"?: string })["@type"] === "JobPosting"
        ) {
          return parsed as GoogleJobPostingJsonLd;
        }
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }

    return undefined;
  }

  private createHtmlHeaders(): Record<string, string> {
    return {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
    };
  }
}

export function createGoogleScraper(
  httpClient: IHttpClient,
  config?: Partial<GoogleConfig>
): GoogleScraper {
  return new GoogleScraper(httpClient, config);
}
