import { load } from "cheerio";
import { z } from "zod";

import {
  containsHtml,
  processDescription,
} from "@/lib/jobs/description-processor";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import {
  parseEmploymentType,
  ScraperPayloadError,
} from "@/lib/scraper/types";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type {
  ApiScraperConfig,
  ScrapeOptions,
  ScrapedJob,
  ScraperResult,
} from "../core/types";
import { selectListingsForHydration } from "./shared/listing-selection";

interface ServiceNowFeedJob {
  title: string;
  date: string;
  apiJobId: string;
  url: string;
  city: string;
  state: string;
  country: string;
  description: string;
  category: string;
  jobType: string;
  remoteType: string;
}

const ServiceNowFeedJobSchema = z
  .object({
    title: z.string().min(1),
    apiJobId: z.string().min(1),
    url: z.string().url(),
  })
  .passthrough();

export type ServiceNowConfig = ApiScraperConfig;

const DEFAULT_SERVICENOW_CONFIG: ServiceNowConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://careers.servicenow.com/jobs/xml/?rss=true",
};

export class ServiceNowScraper extends AbstractApiScraper<ServiceNowConfig> {
  readonly platform = "servicenow" as const;

  constructor(httpClient: IHttpClient, config: Partial<ServiceNowConfig> = {}) {
    super(httpClient, { ...DEFAULT_SERVICENOW_CONFIG, ...config });
  }

  validate(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname.toLowerCase() === "careers.servicenow.com" &&
        parsed.pathname.toLowerCase().startsWith("/jobs")
      );
    } catch {
      return false;
    }
  }

  extractIdentifier(url: string): string | null {
    return this.validate(url) ? "servicenow" : null;
  }

  async scrape(_url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const response = await this.fetchResponse(this.config.baseUrl, {
        headers: this.requestHeaders("application/xml, text/xml, */*"),
      });
      if (!response.ok) {
        return this.failureForHttpStatus(
          response.status,
          `Failed to fetch ServiceNow jobs feed: HTTP ${response.status}`
        );
      }

      const parsedFeed = this.parseFeed(await response.text());
      const jobsById = new Map<string, ScrapedJob>();
      for (const job of parsedFeed.jobs) jobsById.set(job.externalId, job);
      const listings = Array.from(jobsById.values());
      const isComplete =
        parsedFeed.invalidEntries === 0 && listings.length === parsedFeed.totalEntries;

      if (parsedFeed.totalEntries === 0) {
        return {
          outcome: "partial",
          jobs: [],
          totalListings: 0,
          listingCompleteness: "unknown",
        };
      }

      const selection = selectListingsForHydration({
        listings,
        filters: options?.filters,
        existingExternalIds: options?.existingExternalIds,
        toFilterable: (job) => ({
          title: job.title,
          location: job.location,
        }),
        getExternalId: (job) => job.externalId,
      });

      return {
        outcome: isComplete ? "success" : "partial",
        jobs: selection.listings,
        totalListings: listings.length,
        earlyFiltered: selection.earlyFiltered,
        openExternalIds: listings.map((job) => job.externalId),
        listingCompleteness: isComplete ? "complete" : "partial",
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private parseFeed(xml: string): {
    jobs: ScrapedJob[];
    invalidEntries: number;
    totalEntries: number;
  } {
    const $ = load(xml, { xmlMode: true });
    if ($("jobs, rss, source").length === 0) {
      throw new ScraperPayloadError(
        "ServiceNow XML",
        "root must be jobs, rss, or source"
      );
    }

    const jobs: ScrapedJob[] = [];
    let invalidEntries = 0;

    $("job").each((_index, element) => {
      const node = this.extractFeedJob($(element));
      if (!ServiceNowFeedJobSchema.safeParse(node).success) {
        invalidEntries++;
        return;
      }
      jobs.push(this.mapFeedJob(node));
    });

    return {
      jobs,
      invalidEntries,
      totalEntries: $("job").length,
    };
  }

  private extractFeedJob(
    element: ReturnType<ReturnType<typeof load>>
  ): ServiceNowFeedJob {
    return {
      title: element.find("title").text().trim(),
      date: element.find("date").text().trim(),
      apiJobId: element.find("apijobid").text().trim(),
      url: element.find("url").text().trim(),
      city: element.find("city").text().trim(),
      state: element.find("state").text().trim(),
      country: element.find("country").text().trim(),
      description: element.find("description").text().trim(),
      category: element.find("category").text().trim(),
      jobType: element.find("jobtype").text().trim(),
      remoteType: element.find("remotetype").text().trim(),
    };
  }

  private mapFeedJob(node: ServiceNowFeedJob): ScrapedJob {
    const rawLocation = [node.city, node.state, node.country]
      .filter(Boolean)
      .join(", ");
    const normalizedLocation = this.normalizeLocation(rawLocation);
    const remoteLocation = this.normalizeLocation(node.remoteType);
    const processedDescription = node.description
      ? processDescription(
          node.description,
          containsHtml(node.description) ? "html" : "plain"
        )
      : { text: null, format: "plain" as const };
    const postedDate = node.date ? new Date(node.date) : null;

    return {
      externalId: this.generateExternalId(this.platform, node.apiJobId),
      title: node.title,
      url: node.url,
      location: normalizedLocation.location,
      locationType:
        remoteLocation.locationType ?? normalizedLocation.locationType,
      department: node.category || undefined,
      description: processedDescription.text ?? undefined,
      descriptionFormat: processedDescription.format,
      employmentType: parseEmploymentType(node.jobType),
      postedDate:
        postedDate && !Number.isNaN(postedDate.getTime()) ? postedDate : undefined,
    };
  }
}
