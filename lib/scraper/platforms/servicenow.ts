import { load } from "cheerio";
import type { Page } from "playwright";
import { z } from "zod";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";
import { processDescription } from "@/lib/jobs/description-processor";
import {
  createScraperError,
  parseExternalPayload,
  ScraperPayloadError,
  type ScraperError,
} from "@/lib/scraper/types";
import { AbstractBrowserScraper, DEFAULT_BROWSER_CONFIG } from "../core";
import { selectListingsForHydration } from "./shared/listing-selection";
import type { BrowserScraperConfig, ScrapeOptions, ScrapedJob, ScraperResult } from "../core/types";

type ServiceNowListItem = {
  id: string;
  title: string;
  url: string;
  location?: string;
};

type ServiceNowDetail = {
  location?: string;
  locationType?: "remote" | "hybrid" | "onsite";
  description?: string;
  descriptionFormat?: "markdown" | "plain";
};

const ServiceNowListItemSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    url: z.string().min(1),
    location: z.string().optional(),
  })
  .passthrough();

export type ServiceNowConfig = BrowserScraperConfig & {
  requestDelayMs: number;
  maxPages: number;
};

const DEFAULT_SERVICENOW_CONFIG: ServiceNowConfig = {
  ...DEFAULT_BROWSER_CONFIG,
  requestDelayMs: 200,
  maxPages: 100,
};

export class ServiceNowScraper extends AbstractBrowserScraper<ServiceNowConfig> {
  readonly platform = "servicenow" as const;

  constructor(
    httpClient: IHttpClient,
    browserClient: IBrowserClient,
    config: Partial<ServiceNowConfig> = {}
  ) {
    super(httpClient, browserClient, { ...DEFAULT_SERVICENOW_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes("careers.servicenow.com/jobs");
  }

  extractIdentifier(url: string): string | null {
    void url;
    return "servicenow";
  }

  protected async bootstrapSession(url: string) {
    void url;
    return null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      return await this.browserClient.withBrowser(async (page) => {
        if (!(await this.navigateListingPage(page, url))) {
          throw new TypeError("Failed to navigate to ServiceNow listings.");
        }
        await page.waitForTimeout(2500);

        const baseUrl = page.url().replace(/[?#].*$/, "");
        const firstPageHtml = await page.content();
        const totalPages = this.extractTotalPages(firstPageHtml);
        const pagesToScrape = Math.min(totalPages, this.config.maxPages);

        const allItems: ServiceNowListItem[] = [];
        const firstPageItems = this.extractListingItems(baseUrl, firstPageHtml);
        if (firstPageItems.length === 0 && !this.hasExplicitEmptyState(firstPageHtml)) {
          throw new ScraperPayloadError(
            "ServiceNow listings",
            "page did not contain recognized jobs or an explicit empty state"
          );
        }
        allItems.push(...firstPageItems);
        let fetchedPages = 1;

        for (let pageNum = 2; pageNum <= pagesToScrape; pageNum++) {
          const pageUrl = `${baseUrl}?page=${pageNum}`;
          const navigated = await this.navigateListingPage(page, pageUrl);
          if (!navigated) continue;
          await page.waitForTimeout(1500);
          const pageItems = this.extractListingItems(baseUrl, await page.content());
          if (pageItems.length === 0) {
            continue;
          }
          fetchedPages++;
          allItems.push(...pageItems);
        }

        const deduped = new Map<string, ServiceNowListItem>();
        for (const item of allItems) {
          deduped.set(item.id, item);
        }
        const items = parseExternalPayload(
          z.array(ServiceNowListItemSchema),
          Array.from(deduped.values()),
          "ServiceNow listings"
        );

        const selection = selectListingsForHydration({
          listings: items,
          filters: options?.filters,
          existingExternalIds: options?.existingExternalIds,
          toFilterable: (item) => ({
            title: item.title,
            location: item.location ?? "",
          }),
          getExternalId: (item) =>
            this.generateExternalId(this.platform, item.id),
        });
        const jobs: ScrapedJob[] = [];
        let detailFailures = 0;

        for (const item of selection.listings) {
          try {
            await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: this.config.timeout });
            await page.waitForTimeout(this.config.requestDelayMs);
            const detail = this.parseDetailHtml(item, await page.content());
            jobs.push(detail);
          } catch (error) {
            throwIfScrapeAborted(error);
            detailFailures++;
            jobs.push({
              externalId: this.generateExternalId(this.platform, item.id),
              title: item.title,
              url: item.url,
              location: item.location,
              locationType: item.location ? "onsite" : undefined,
            });
          }
        }

        const listingComplete = fetchedPages >= totalPages;
        const issues: ScraperError[] = [];
        if (!listingComplete) {
          issues.push(
            createScraperError(
              "network_error",
              `ServiceNow listings were only partially fetched (${fetchedPages} of ${totalPages} advertised pages).`
            )
          );
        }
        if (detailFailures > 0) {
          issues.push(
            createScraperError(
              "browser_error",
              `${detailFailures} ServiceNow job detail page${detailFailures === 1 ? "" : "s"} failed; listing data was retained.`
            )
          );
        }

        return {
          outcome: issues.length > 0 ? "partial" : "success",
          jobs,
          totalListings: items.length,
          earlyFiltered: selection.earlyFiltered,
          openExternalIds: items.map((item) =>
            this.generateExternalId(this.platform, item.id)
          ),
          listingCompleteness: listingComplete ? "complete" : "partial",
          issues: issues.length > 0 ? issues : undefined,
        };
      });
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private async navigateListingPage(page: Page, url: string): Promise<boolean> {
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.config.timeout,
        });
        return true;
      } catch (error) {
        throwIfScrapeAborted(error);
        if (attempt >= this.config.retries) return false;
        await this.delay(this.config.baseDelay * 2 ** attempt);
      }
    }
    return false;
  }

  private extractTotalPages(html: string): number {
    const $ = load(html);
    let maxPage = 1;
    $('a[href*="page="]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const match = href.match(/page=(\d+)/);
      if (match?.[1]) {
        const parsed = Number(match[1]);
        if (Number.isFinite(parsed) && parsed > maxPage) {
          maxPage = parsed;
        }
      }
      const textPage = Number($(el).text().trim());
      if (Number.isFinite(textPage) && textPage > maxPage) {
        maxPage = textPage;
      }
    });

    return maxPage;
  }

  private hasExplicitEmptyState(html: string): boolean {
    const text = load(html).text().replace(/\s+/g, " ").trim();
    return /(?:no jobs|no matching jobs|no results|0 jobs|currently no open roles)/i.test(text);
  }

  private extractListingItems(baseUrl: string, html: string): ServiceNowListItem[] {
    const $ = load(html);
    const items: ServiceNowListItem[] = [];

    $("main h2 a[href^='/jobs/']").each((_, element) => {
      const href = $(element).attr("href");
      if (!href) return;
      const title = $(element).text().trim();
      const idMatch = href.match(/\/jobs\/(\d+)\//);
      if (!title || !idMatch?.[1]) return;

      const card = $(element).closest("div");
      const location = card.find("li").first().text().trim() || undefined;

      items.push({
        id: idMatch[1],
        title,
        url: new URL(href, baseUrl).toString(),
        location,
      });
    });

    return items;
  }

  private parseDetailHtml(item: ServiceNowListItem, html: string): ScrapedJob {
    const $ = load(html);
    const detail = this.extractDetailInfo($);

    return {
      externalId: this.generateExternalId(this.platform, item.id),
      title: item.title,
      url: item.url,
      location: detail.location || item.location,
      locationType: detail.locationType,
      description: detail.description,
      descriptionFormat: detail.descriptionFormat,
    };
  }

  private extractDetailInfo($: ReturnType<typeof load>): ServiceNowDetail {
    const metadataList = $("main ul").first();
    let location: string | undefined;
    let isRemote = false;
    let isHybrid = false;
    let isOnsite = false;

    metadataList.find("li").each((_, el) => {
      const linkText = $(el).find("a").first().text().trim();
      const href = $(el).find("a").first().attr("href") ?? "";
      const fullText = $(el).text().trim();

      if (linkText && !href.includes("/teams/") && !href.includes("/jobs/saved")) {
        location = linkText;
      } else if (/^remote$/i.test(fullText)) {
        isRemote = true;
      } else if (/^hybrid$/i.test(fullText)) {
        isHybrid = true;
      } else if (/^required in office$/i.test(fullText)) {
        isOnsite = true;
      } else if (/^flexible$/i.test(fullText)) {
        isHybrid = true;
      }
    });

    const locationType = isRemote
      ? "remote"
      : isHybrid
        ? "hybrid"
        : isOnsite || location
          ? "onsite"
          : undefined;

    const descriptionRoot =
      this.extractRelevantDescriptionHtml($) ||
      $(".job-description").html() ||
      $("main article").html() ||
      "";
    const processed = processDescription(descriptionRoot, "html");

    return {
      location,
      locationType,
      description: processed.text ?? undefined,
      descriptionFormat: processed.format,
    };
  }

  private extractRelevantDescriptionHtml($: ReturnType<typeof load>): string | null {
    const sections = [
      this.extractSectionHtml($, "Job Description"),
      this.extractSectionHtml($, "Additional Information"),
    ].filter(Boolean) as string[];

    if (sections.length === 0) {
      return null;
    }

    return sections.join("\n");
  }

  private extractSectionHtml($: ReturnType<typeof load>, title: string): string | null {
    const normalizedTitle = title.toLowerCase();
    const heading = $("h1, h2, h3, h4")
      .filter((_, element) => $(element).text().trim().toLowerCase().includes(normalizedTitle))
      .first();

    if (!heading.length) {
      return null;
    }

    const section = heading.closest("section, article");
    if (section.length) {
      return section.html() ?? null;
    }

    const fragment = $("<div></div>");
    fragment.append(heading.clone());
    heading.nextUntil("h1, h2, h3, h4").each((_, element) => {
      fragment.append($(element).clone());
    });

    return fragment.html() ?? null;
  }
}
