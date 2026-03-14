import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { containsHtml, decodeHtmlEntities, processDescription } from "@/lib/jobs/description-processor";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ApiScraperConfig, ScrapeOptions, ScrapedJob, ScraperResult } from "../core/types";

type ZwayamJobRecord = {
  id: number;
  jobCode?: number | string;
  refNumber?: string;
  newJobCode?: string;
  location?: string;
  Location?: string;
  locationSeparatedbySlash?: string;
  departmentName?: string;
  designation?: string;
  experienceUIField?: string;
  reqCurrency?: string;
  currencyType?: string;
  ctcBandLowEnd?: string | number | null;
  ctcBandHighEnd?: string | number | null;
  modifiedDate?: number;
  createdDate?: number;
  jobCreatedDate?: number;
  jobDescription?: string | null;
  shortDescriptionDb?: string | null;
  notes?: string | null;
  ["Requisition Title"]?: string;
  text5?: string;
  careerUrl?: string | null;
  roles?: string;
  jobUrl?: string | null;
};

type ZwayamSearchHit = {
  _source: ZwayamJobRecord;
};

type ZwayamResponse = {
  code: number;
  data?: {
    data: ZwayamSearchHit[];
    totalCount: number;
    hasMoreData: boolean;
  };
};

type ZwayamFilterCriteria = {
  paginationStartNo: number;
  selectedCall: "sort";
  sortCriteria: {
    name: "modifiedDate";
    isAscending: boolean;
  };
  anyOfTheseWords: string;
};

type ZwayamDetailResponse = {
  responseStatus: string;
  responseCode: number;
  reponseObject?: {
    customDetails?: Record<string, string>;
  };
};

export type ZwayamConfig = ApiScraperConfig & {
  pageSize: number;
};

export const DEFAULT_ZWAYAM_CONFIG: ZwayamConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://public.zwayam.com",
  pageSize: 10,
};

export class ZwayamScraper extends AbstractApiScraper<ZwayamConfig> {
  readonly platform = "zwayam" as const;

  constructor(httpClient: IHttpClient, config: Partial<ZwayamConfig> = {}) {
    super(httpClient, { ...DEFAULT_ZWAYAM_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.includes(".zwayam.com") ||
      lower.includes("public.zwayam.com") ||
      lower.includes("flipkartcareers.com/flipkart/jobslist")
    );
  }

  extractIdentifier(url: string): string | null {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();

      if (hostname === "www.flipkartcareers.com") {
        return "flipkart";
      }

      if (hostname.endsWith(".zwayam.com")) {
        return hostname.replace(/\.zwayam\.com$/i, "");
      }

      const pathSegments = parsed.pathname.split("/").filter(Boolean);
      if (hostname.includes("careers") && pathSegments[0]) {
        return pathSegments[0].toLowerCase();
      }
    } catch {
      return null;
    }

    return null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const tenant = options?.boardToken || this.extractIdentifier(url);
      if (!tenant) {
        return {
          success: false,
          outcome: "error",
          jobs: [],
          error: "Could not determine Zwayam tenant from URL. Please provide a board token manually.",
        };
      }

      const companyId = this.resolveCompanyId(tenant);
      const numericCompanyId = this.resolveNumericCompanyId(tenant);
      const domain = this.resolveDomain(url);
      const jobEntries: Array<{ job: ScrapedJob; needsDetail: boolean; jobId: number }> = [];
      let paginationStartNo = 0;
      let isComplete = true;
      let hadDetailFailures = false;

      while (true) {
        const response = await this.fetchPage({
          tenant,
          companyId,
          domain,
          paginationStartNo,
        });

        const pageJobs = response.data?.data ?? [];
        const totalCount = response.data?.totalCount;

        if (pageJobs.length === 0) {
          break;
        }

        for (const hit of pageJobs) {
          jobEntries.push(this.mapJob(tenant, hit._source, domain));
        }

        paginationStartNo += pageJobs.length;

        const hasMoreData = response.data?.hasMoreData;

        if (hasMoreData === false) {
          break;
        }

        if (typeof totalCount === "number" && paginationStartNo >= totalCount && hasMoreData !== true) {
          break;
        }

        if (hasMoreData === undefined && pageJobs.length < this.config.pageSize) {
          isComplete = typeof totalCount === "number" ? paginationStartNo >= totalCount : true;
          break;
        }
      }

      for (const entry of jobEntries) {
        if (!entry.needsDetail) continue;
        try {
          const detail = await this.fetchJobDetail(entry.jobId, numericCompanyId);
          if (detail) {
            entry.job.description = detail.text ?? undefined;
            entry.job.descriptionFormat = detail.format;
          }
        } catch {
          hadDetailFailures = true;
        }
      }

      const dedupedJobs = this.deduplicateJobs(jobEntries.map((entry) => entry.job));
      const hasPartialDetails = hadDetailFailures && dedupedJobs.length > 0;

      return {
        success: isComplete && !hasPartialDetails,
        outcome: isComplete && !hasPartialDetails ? "success" : "partial",
        jobs: dedupedJobs,
        detectedBoardToken: !options?.boardToken ? tenant : undefined,
        openExternalIds: dedupedJobs.map((job) => job.externalId),
        openExternalIdsComplete: isComplete,
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

  private async fetchPage(args: {
    tenant: string;
    companyId: string;
    domain: string;
    paginationStartNo: number;
  }): Promise<ZwayamResponse> {
    const form = new FormData();
    const filterCri: ZwayamFilterCriteria = {
      paginationStartNo: args.paginationStartNo,
      selectedCall: "sort",
      sortCriteria: {
        name: "modifiedDate",
        isAscending: false,
      },
      anyOfTheseWords: "",
    };

    form.set("filterCri", JSON.stringify(filterCri));
    form.set("domain", args.domain);
    form.set("companyId", args.companyId);

    const response = await this.httpClient.fetch(`${this.config.baseUrl}/jobs/search`, {
      method: "POST",
      body: form,
      timeout: this.config.timeout,
      retries: this.config.retries,
      baseDelay: this.config.baseDelay,
      headers: {
        Accept: "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Zwayam jobs: ${response.status}`);
    }

    return response.json() as Promise<ZwayamResponse>;
  }

  private mapJob(
    tenant: string,
    record: ZwayamJobRecord,
    domain: string
  ): { job: ScrapedJob; needsDetail: boolean; jobId: number } {
    const rawLocation =
      record.locationSeparatedbySlash ||
      record.location ||
      record.Location;
    const { location, locationType } = this.normalizeLocation(rawLocation);
    const externalJobId =
      record.jobCode ||
      record.refNumber ||
      record.newJobCode ||
      record.id;

    const description = this.resolveDescription(record);
    const processedDescription = processDescription(
      description,
      containsHtml(description ?? "") ? "html" : "plain"
    );

    const job: ScrapedJob = {
      externalId: this.generateExternalId(this.platform, tenant, externalJobId),
      title: record["Requisition Title"] || record.designation || record.roles || "Untitled Role",
      url: this.buildJobUrl(domain, tenant, record),
      location,
      locationType,
      department: record.departmentName || record.text5,
      description: processedDescription.text ?? undefined,
      descriptionFormat: processedDescription.format,
      salary: this.resolveSalary(record),
      postedDate: this.resolveDate(record),
    };

    return {
      job,
      needsDetail: this.isLowQualityDescription(description),
      jobId: record.id,
    };
  }

  private resolveDescription(record: ZwayamJobRecord): string | undefined {
    const description =
      record.jobDescription ||
      record.shortDescriptionDb;
    return typeof description === "string" && description.trim().length > 0
      ? decodeHtmlEntities(description.trim())
      : undefined;
  }

  private resolveSalary(record: ZwayamJobRecord): string | undefined {
    if (record.ctcBandLowEnd || record.ctcBandHighEnd) {
      const currency = record.reqCurrency || record.currencyType || "";
      return `${record.ctcBandLowEnd ?? "?"} - ${record.ctcBandHighEnd ?? "?"} ${currency}`.trim();
    }

    return undefined;
  }

  private resolveDate(record: ZwayamJobRecord): Date | undefined {
    const timestamp = record.modifiedDate || record.jobCreatedDate || record.createdDate;
    return timestamp ? new Date(timestamp) : undefined;
  }

  private buildJobUrl(domain: string, tenant: string, record: ZwayamJobRecord): string {
    if (record.careerUrl) {
      if (!domain.endsWith("flipkartcareers.com") || !record.careerUrl.includes("/candidate/")) {
        return record.careerUrl;
      }
    }

    const externalId = record.newJobCode || record.refNumber || record.jobCode || record.id;
    if (domain.endsWith("flipkartcareers.com")) {
      const jobId = record.id || externalId;
      if (record.jobUrl) {
        return `https://${domain}/${tenant}/jobview/${record.jobUrl}?id=${jobId}`;
      }
      return `https://${domain}/${tenant}/jobview?id=${jobId}`;
    }
    return `https://${domain}/candidate/jobs/view/${externalId}`;
  }

  private deduplicateJobs(jobs: ScrapedJob[]): ScrapedJob[] {
    const seen = new Set<string>();
    return jobs.filter((job) => {
      if (seen.has(job.externalId)) {
        return false;
      }
      seen.add(job.externalId);
      return true;
    });
  }

  private isLowQualityDescription(description?: string): boolean {
    if (!description) return true;
    const normalized = description.trim().toLowerCase();
    if (normalized.length === 0) return true;
    const badValues = new Set(["ok", "approved", "na", "n/a", "none", "null"]);
    if (badValues.has(normalized)) return true;
    return normalized.length < 10;
  }

  private async fetchJobDetail(
    jobId: number,
    companyId: number
  ): Promise<{ text: string | null; format: "markdown" | "plain" } | null> {
    const url = `${this.config.baseUrl}/requisition_service/getReqFieldsForCareersSite/${jobId}/${companyId}`;
    const response = await this.httpClient.fetch(url, {
      timeout: this.config.timeout,
      retries: this.config.retries,
      baseDelay: this.config.baseDelay,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as ZwayamDetailResponse;
    const customDetails = data.reponseObject?.customDetails;
    if (!customDetails) {
      return null;
    }

    const combined = this.combineCustomDetails(customDetails);
    if (!combined) {
      return null;
    }

    return processDescription(combined, "html");
  }

  private combineCustomDetails(customDetails: Record<string, string>): string | null {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(customDetails)) {
      if (!value || typeof value !== "string" || value.trim().length === 0) {
        continue;
      }
      parts.push(`<h2>${key}</h2>\n${value}`);
    }

    if (parts.length === 0) {
      return null;
    }

    return parts.join("\n\n");
  }

  private resolveCompanyId(tenant: string): string {
    const knownCompanyIds: Record<string, string> = {
      flipkart: "MTUxMTA=",
    };

    return knownCompanyIds[tenant] ?? tenant;
  }

  private resolveNumericCompanyId(tenant: string): number {
    const knownNumericIds: Record<string, number> = {
      flipkart: 15110,
    };

    return knownNumericIds[tenant] ?? NaN;
  }

  private resolveDomain(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return "www.flipkartcareers.com";
    }
  }
}

export function createZwayamScraper(
  httpClient: IHttpClient,
  config?: Partial<ZwayamConfig>
): ZwayamScraper {
  return new ZwayamScraper(httpClient, config);
}
