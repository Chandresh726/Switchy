import { load } from "cheerio";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig } from "../core/types";

interface NutanixJobNode {
  title: string;
  date: string;
  requisitionId: string;
  apiJobId: string;
  url: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  description: string;
  category: string;
  jobType: string;
  remoteType: string;
  lastActivityDate: string;
}

export type NutanixConfig = ApiScraperConfig;

export const DEFAULT_NUTANIX_CONFIG: NutanixConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://careers.nutanix.com/en/jobs/xml/",
};

export class NutanixScraper extends AbstractApiScraper<NutanixConfig> {
  readonly platform = "nutanix" as const;

  constructor(
    httpClient: IHttpClient,
    config: Partial<NutanixConfig> = {}
  ) {
    super(httpClient, { ...DEFAULT_NUTANIX_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return urlLower.includes("careers.nutanix.com") ||
      (urlLower.includes("nutanix.com") && urlLower.includes("career"));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  extractIdentifier(_url: string): string | null {
    return "nutanix";
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const feedUrl = `${this.config.baseUrl}?rss=true`;

      const response = await this.httpClient.fetch(feedUrl, {
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
        headers: {
          Accept: "application/xml, text/xml, */*",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          outcome: "error",
          jobs: [],
          error: `Failed to fetch Nutanix jobs: HTTP ${response.status}`,
        };
      }

      const xmlText = await response.text();
      const jobs = this.parseXmlJobs(xmlText);

      return {
        success: true,
        outcome: jobs.length > 0 ? "success" : "partial",
        jobs,
        detectedBoardToken: !options?.boardToken ? "nutanix" : undefined,
        openExternalIds: jobs.map((j) => j.externalId),
        openExternalIdsComplete: true,
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

  private parseXmlJobs(xmlText: string): ScrapedJob[] {
    const $ = load(xmlText, { xmlMode: true });
    const jobs: ScrapedJob[] = [];

    $("job").each((_idx, el) => {
      const $el = $(el);
      const node = this.extractJobNode($el);

      if (!node.title || !node.apiJobId) {
        return;
      }

      const locationString = this.buildLocationString(node);
      const { location, locationType } = this.normalizeLocation(locationString);

      const postedDate = this.parseDate(node.date);

      jobs.push({
        externalId: this.generateExternalId(this.platform, "nutanix", node.apiJobId),
        title: node.title,
        url: node.url,
        location,
        locationType,
        department: node.category || undefined,
        description: node.description || undefined,
        descriptionFormat: "html",
        postedDate: postedDate ?? undefined,
      });
    });

    return jobs;
  }

  private extractJobNode($el: ReturnType<ReturnType<typeof load>>): NutanixJobNode {
    return {
      title: $el.find("title").text().trim(),
      date: $el.find("date").text().trim(),
      requisitionId: $el.find("requisitionid").text().trim(),
      apiJobId: $el.find("apijobid").text().trim(),
      url: $el.find("url").text().trim(),
      city: $el.find("city").text().trim(),
      state: $el.find("state").text().trim(),
      country: $el.find("country").text().trim(),
      postalCode: $el.find("postalcode").text().trim(),
      description: $el.find("description").text().trim(),
      category: $el.find("category").text().trim(),
      jobType: $el.find("jobtype").text().trim(),
      remoteType: $el.find("remotetype").text().trim(),
      lastActivityDate: $el.find("lastactivitydate").text().trim(),
    };
  }

  private buildLocationString(node: NutanixJobNode): string {
    const parts: string[] = [];
    if (node.city) parts.push(node.city);
    if (node.state) parts.push(node.state);
    if (node.country) parts.push(node.country);
    return parts.join(", ");
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
}

export function createNutanixScraper(
  httpClient: IHttpClient,
  config?: Partial<NutanixConfig>
): NutanixScraper {
  return new NutanixScraper(httpClient, config);
}
