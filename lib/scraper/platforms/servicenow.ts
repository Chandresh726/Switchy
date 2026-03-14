import { load } from "cheerio";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { processDescription } from "@/lib/jobs/description-processor";
import { AbstractBrowserScraper, DEFAULT_BROWSER_CONFIG } from "../core";
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

export type ServiceNowConfig = BrowserScraperConfig & {
  requestDelayMs: number;
  maxPages: number;
};

export const DEFAULT_SERVICENOW_CONFIG: ServiceNowConfig = {
  ...DEFAULT_BROWSER_CONFIG,
  requestDelayMs: 200,
  maxPages: 10,
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
    void options;
    try {
      return await this.browserClient.withBrowser(async (page) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.config.timeout });
        await page.waitForTimeout(2500);

        const baseUrl = page.url().replace(/[?#].*$/, "");
        const firstPageHtml = await page.content();
        const totalPages = this.extractTotalPages(firstPageHtml);
        const pagesToScrape = Math.min(totalPages, this.config.maxPages);

        const allItems: ServiceNowListItem[] = [];
        const firstPageItems = this.extractListingItems(baseUrl, firstPageHtml);
        allItems.push(...firstPageItems);

        for (let pageNum = 2; pageNum <= pagesToScrape; pageNum++) {
          const pageUrl = `${baseUrl}?page=${pageNum}`;
          await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: this.config.timeout });
          await page.waitForTimeout(1500);
          const pageItems = this.extractListingItems(baseUrl, await page.content());
          if (pageItems.length === 0) break;
          allItems.push(...pageItems);
        }

        const deduped = new Map<string, ServiceNowListItem>();
        for (const item of allItems) {
          deduped.set(item.id, item);
        }
        const items = Array.from(deduped.values());

        const jobs: ScrapedJob[] = [];
        let hadPartialFailures = false;

        for (const item of items) {
          try {
            await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: this.config.timeout });
            await page.waitForTimeout(this.config.requestDelayMs);
            const detail = this.parseDetailHtml(item, await page.content());
            jobs.push(detail);
          } catch {
            hadPartialFailures = true;
            jobs.push({
              externalId: this.generateExternalId(this.platform, item.id),
              title: item.title,
              url: item.url,
              location: item.location,
              locationType: item.location ? "onsite" : undefined,
            });
          }
        }

        return {
          success: !hadPartialFailures,
          outcome: hadPartialFailures ? "partial" : "success",
          jobs,
          openExternalIds: jobs.map((job) => job.externalId),
          openExternalIdsComplete: pagesToScrape >= totalPages,
        };
      });
    } catch (error) {
      return {
        success: false,
        outcome: "error",
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private extractTotalPages(html: string): number {
    const $ = load(html);
    const lastPageLink = $('a[href*="page="]').filter((_, el) => {
      const text = $(el).text().trim();
      return /^\d+$/.test(text);
    }).last();

    if (lastPageLink.length) {
      const pageText = lastPageLink.text().trim();
      const parsed = Number(pageText);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

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
    });

    return maxPage;
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

export function createServiceNowScraper(
  httpClient: IHttpClient,
  browserClient: IBrowserClient,
  config?: Partial<ServiceNowConfig>
): ServiceNowScraper {
  return new ServiceNowScraper(httpClient, browserClient, config);
}
