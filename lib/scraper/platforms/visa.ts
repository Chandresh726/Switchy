import { z } from "zod";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";

import { parseEmploymentType, parseExternalPayload } from "@/lib/scraper/types";
import { processDescription } from "@/lib/jobs/description-processor";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ApiScraperConfig, ScrapedJob, ScraperResult } from "../core/types";

type VisaJob = {
  refNumber: string;
  postingId?: string;
  jobTitle: string;
  jobDescription?: string;
  qualifications?: string;
  city?: string;
  state?: string;
  country?: string;
  primaryLocation?: string;
  travelRequired?: string;
  businessUnit?: string;
  category?: string;
  department?: string;
  jobType?: string;
  employmentType?: string;
  workerType?: string;
  postedDate?: string;
  updatedDate?: string;
};

type VisaJobsResponse = {
  successful: boolean;
  totalRecords?: number;
  recordsMatched?: number;
  pageSize?: number;
  from?: number;
  jobDetails: VisaJob[];
};

const VisaJobsResponseSchema = z
  .object({
    successful: z.literal(true),
    totalRecords: z.number().optional(),
    recordsMatched: z.number().optional(),
    pageSize: z.number().optional(),
    from: z.number().optional(),
    jobDetails: z.array(
      z
        .object({
          refNumber: z.string(),
          postingId: z.string().optional(),
          jobTitle: z.string(),
          jobDescription: z.string().optional(),
          qualifications: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          country: z.string().optional(),
          primaryLocation: z.string().optional(),
          businessUnit: z.string().optional(),
          category: z.string().optional(),
          department: z.string().optional(),
          jobType: z.string().optional(),
          employmentType: z.string().optional(),
          workerType: z.string().optional(),
          postedDate: z.string().optional(),
          updatedDate: z.string().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();

export type VisaConfig = ApiScraperConfig & {
  pageSize: number;
};

export const DEFAULT_VISA_CONFIG: VisaConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://search.visa.com",
  pageSize: 100,
};

export class VisaScraper extends AbstractApiScraper<VisaConfig> {
  readonly platform = "visa" as const;

  constructor(httpClient: IHttpClient, config: Partial<VisaConfig> = {}) {
    super(httpClient, { ...DEFAULT_VISA_CONFIG, ...config });
  }

  validate(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname.toLowerCase().includes("visa.") && parsed.pathname.includes("/jobs");
    } catch {
      return false;
    }
  }

  extractIdentifier(url: string): string | null {
    void url;
    return "visa";
  }

  async scrape(url: string): Promise<ScraperResult> {
    try {
      const parsed = this.parseSourceUrl(url);
      if (!parsed) {
        return this.failure("invalid_url", "Invalid Visa Careers URL.");
      }
      const functions = parsed.searchParams.getAll("functions").filter(Boolean);
      const cities = parsed.searchParams.getAll("cities").filter(Boolean);

      const jobs: ScrapedJob[] = [];
      let from = 0;
      let totalRecords = Number.POSITIVE_INFINITY;
      let isComplete = true;

      while (from < totalRecords) {
        const payload = await this.post<unknown>(
          `${this.config.baseUrl}/CAREERS/careers/jobs?q=`,
          {
            filters: functions.length > 0 ? [{ superDepartment: functions }] : [],
            city: cities,
            from,
            size: this.config.pageSize,
          },
          {
            headers: this.requestHeaders("application/json, text/plain, */*", {
              Referer: url,
            }),
          }
        );
        const page: VisaJobsResponse = parseExternalPayload(
          VisaJobsResponseSchema,
          payload,
          "Visa"
        );

        const pageJobs = page.jobDetails ?? [];
        totalRecords = page.recordsMatched || page.totalRecords || pageJobs.length;
        jobs.push(...pageJobs.map((job) => this.mapJob(job, parsed)));

        from += pageJobs.length;
        if (pageJobs.length === 0 || pageJobs.length < this.config.pageSize) {
          isComplete = from >= totalRecords;
          break;
        }
      }

      const dedupedJobs = this.deduplicate(jobs);

      return {
        outcome: isComplete ? "success" : "partial",
        jobs: dedupedJobs,
        totalListings: dedupedJobs.length,
        openExternalIds: dedupedJobs.map((job) => job.externalId),
        listingCompleteness: isComplete ? "complete" : "partial",
      };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private mapJob(job: VisaJob, parsedUrl: URL): ScrapedJob {
    const rawLocation =
      job.primaryLocation ||
      [job.city, job.state, job.country].filter(Boolean).join(", ");
    const { location, locationType } = this.normalizeLocation(rawLocation);
    const descriptionParts = [job.jobDescription, job.qualifications].filter(Boolean).join("\n\n");
    const processedDescription = descriptionParts
      ? processDescription(descriptionParts, "html")
      : { text: null, format: "plain" as const };

    return {
      externalId: this.generateExternalId(this.platform, job.refNumber || job.postingId),
      title: job.jobTitle,
      url: new URL(`/en_gb/jobs/${job.refNumber}`, `${parsedUrl.protocol}//${parsedUrl.hostname}`).toString(),
      location,
      locationType,
      department: job.businessUnit || job.department || job.category,
      description: processedDescription.text ?? undefined,
      descriptionFormat: processedDescription.format,
      employmentType: parseEmploymentType(job.employmentType || job.workerType || job.jobType),
      postedDate: job.postedDate ? new Date(job.postedDate) : job.updatedDate ? new Date(job.updatedDate) : undefined,
    };
  }

  private deduplicate(jobs: ScrapedJob[]): ScrapedJob[] {
    const seen = new Set<string>();
    return jobs.filter((job) => {
      if (seen.has(job.externalId)) return false;
      seen.add(job.externalId);
      return true;
    });
  }
}
