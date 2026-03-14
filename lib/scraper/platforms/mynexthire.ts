import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";

import { containsHtml, decodeHtmlEntities, processDescription } from "@/lib/jobs/description-processor";
import { parseEmploymentType } from "@/lib/scraper/types";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ApiScraperConfig, ScrapeOptions, ScrapedJob, ScraperResult } from "../core/types";

type MynextHireJob = {
  reqId: number;
  reqTitle: string;
  buName?: string;
  location?: string;
  locationAddress?: string;
  jdDisplay?: string;
  approvedOn?: number;
  employmentType?: string;
  reqCurrency?: string;
  ctcBandLowEnd?: string | number | null;
  ctcBandHighEnd?: string | number | null;
};

type MynextHireResponse = {
  requesterTitle: string;
  reqDetailsBOList: MynextHireJob[];
};

export type MynextHireConfig = ApiScraperConfig;

export const DEFAULT_MYNEXTHIRE_CONFIG: MynextHireConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://mynexthire.com",
};

export class MynextHireScraper extends AbstractApiScraper<MynextHireConfig> {
  readonly platform = "mynexthire" as const;

  constructor(httpClient: IHttpClient, config: Partial<MynextHireConfig> = {}) {
    super(httpClient, { ...DEFAULT_MYNEXTHIRE_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes(".mynexthire.com") || lower.includes("careers.swiggy.com");
  }

  extractIdentifier(url: string): string | null {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      if (hostname.includes("careers.swiggy.com")) {
        return "swiggy";
      }
      if (hostname.endsWith(".mynexthire.com")) {
        return hostname.replace(/\.mynexthire\.com$/i, "");
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
          error: "Could not determine MynextHire tenant from URL. Please provide a board token manually.",
        };
      }

      const tenantHost = this.resolveTenantHost(url, tenant);
      const data = await this.post<MynextHireResponse>(
        `https://${tenantHost}/employer/careers/reqlist/get`,
        {
          source: "careers",
          code: "",
          filterByBuId: -1,
        },
        {
          headers: {
            Accept: "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
          },
        }
      );

      const jobs = data.reqDetailsBOList.map((job) => this.mapJob(tenant, tenantHost, url, job));

      return {
        success: true,
        outcome: "success",
        jobs,
        detectedBoardToken: !options?.boardToken ? tenant : undefined,
        openExternalIds: jobs.map((job) => job.externalId),
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

  private mapJob(
    tenant: string,
    tenantHost: string,
    sourceUrl: string,
    job: MynextHireJob
  ): ScrapedJob {
    const { location, locationType } = this.normalizeLocation(job.location || job.locationAddress);
    const rawDescription = decodeHtmlEntities(job.jdDisplay?.trim() || "");
    const isHtml = containsHtml(rawDescription);
    const normalizedDescription = isHtml
      ? rawDescription
      : this.formatPlainDescription(rawDescription);
    const processedDescription = processDescription(
      normalizedDescription,
      isHtml ? "html" : "plain"
    );

    return {
      externalId: this.generateExternalId(this.platform, tenant, job.reqId),
      title: job.reqTitle,
      url: this.buildJobUrl(tenant, tenantHost, sourceUrl, job.reqId),
      location,
      locationType,
      department: job.buName,
      description: processedDescription.text ?? undefined,
      descriptionFormat: processedDescription.format,
      employmentType: parseEmploymentType(job.employmentType),
      salary: this.resolveSalary(job),
      postedDate: job.approvedOn ? new Date(job.approvedOn) : undefined,
    };
  }

  private resolveSalary(job: MynextHireJob): string | undefined {
    if (job.ctcBandLowEnd || job.ctcBandHighEnd) {
      return `${job.ctcBandLowEnd ?? "?"} - ${job.ctcBandHighEnd ?? "?"} ${job.reqCurrency ?? ""}`.trim();
    }
    return undefined;
  }

  private buildJobUrl(tenant: string, tenantHost: string, sourceUrl: string, jobId: number): string {
    if (tenant === "swiggy" || sourceUrl.includes("careers.swiggy.com")) {
      const payload = {
        pageType: "jd",
        cvSource: "careers",
        reqId: jobId,
        requester: { id: "", code: "", name: "" },
        page: "careers",
        bufilter: -1,
        customFields: {},
      };
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
      const query = encodeURIComponent(`src=careers&p=${encoded}`);
      return `https://careers.swiggy.com/#/careers?${query}`;
    }

    return `https://${tenantHost}/employer/jobs?ref=view/${jobId}/-1#/view/${jobId}/-1`;
  }

  private formatPlainDescription(text: string): string {
    const normalized = text.replace(/\r\n/g, "\n").trim();
    if (!normalized) return normalized;

    let formatted = normalized.replace(/^\s*[*•]\s+/gm, "- ");

    if (formatted.includes(" * ") && !formatted.includes("\n- ")) {
      const parts = formatted.split(" * ").map((part) => part.trim()).filter(Boolean);
      if (parts.length > 1) {
        formatted = [parts[0], ...parts.slice(1).map((part) => `- ${part}`)].join("\n\n");
      }
    }

    return formatted;
  }

  private resolveTenantHost(url: string, tenant: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.endsWith(".mynexthire.com")) {
        return parsed.hostname;
      }
    } catch {
      // Fall through to inferred host.
    }

    return `${tenant}.mynexthire.com`;
  }
}

export function createMynextHireScraper(
  httpClient: IHttpClient,
  config?: Partial<MynextHireConfig>
): MynextHireScraper {
  return new MynextHireScraper(httpClient, config);
}
