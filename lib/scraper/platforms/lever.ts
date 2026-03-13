import { processDescription } from "@/lib/jobs/description-processor";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { parseEmploymentType } from "@/lib/scraper/types";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig } from "../core/types";

interface LeverList {
  text?: string;
  content?: string;
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  categories: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
  };
  description?: string;
  descriptionBody?: string;
  descriptionBodyPlain?: string;
  descriptionPlain?: string;
  additional?: string;
  additionalPlain?: string;
  opening?: string;
  openingPlain?: string;
  lists?: LeverList[];
  createdAt: number;
}

export type LeverConfig = ApiScraperConfig;

export const DEFAULT_LEVER_CONFIG: LeverConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://api.lever.co",
};

export class LeverScraper extends AbstractApiScraper<LeverConfig> {
  readonly platform = "lever" as const;

  constructor(
    httpClient: IHttpClient,
    config: Partial<LeverConfig> = {}
  ) {
    super(httpClient, { ...DEFAULT_LEVER_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return urlLower.includes("lever.co") || urlLower.includes("jobs.lever");
  }

  extractIdentifier(url: string): string | null {
    const patterns = [
      /jobs\.lever\.co\/([^\/\?]+)/i,
      /([^\.]+)\.lever\.co/i,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1] && match[1] !== "jobs") {
        return match[1];
      }
    }

    return null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const companySlug = options?.boardToken || this.extractIdentifier(url);
      const detectedBoardToken = !options?.boardToken && companySlug ? companySlug : undefined;

      if (!companySlug) {
        return {
          success: false,
          outcome: "error",
          jobs: [],
          error: "Could not extract company slug from URL. Please provide the board token manually.",
        };
      }

      const apiUrl = `${this.config.baseUrl}/v0/postings/${companySlug}?mode=json`;

      const response = await this.httpClient.fetch(apiUrl, {
        timeout: this.config.timeout,
        retries: this.config.retries,
        baseDelay: this.config.baseDelay,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          outcome: "error",
          jobs: [],
          error: `Failed to fetch jobs: ${response.status}`,
        };
      }

      const data: LeverJob[] = await response.json();
      return this.parseJobs(data, companySlug, detectedBoardToken);
    } catch (error) {
      return {
        success: false,
        outcome: "error",
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private parseJobs(
    data: LeverJob[],
    companySlug: string,
    detectedBoardToken?: string
  ): ScraperResult {
    const jobs: ScrapedJob[] = data.map((job) => {
      const { location, locationType } = this.normalizeLocation(
        job.categories?.location
      );
      const { description, descriptionFormat } = this.buildDescription(job);

      return {
        externalId: this.generateExternalId(this.platform, companySlug, job.id),
        title: job.text,
        url: job.hostedUrl,
        location,
        locationType,
        department: job.categories?.team || job.categories?.department,
        employmentType: parseEmploymentType(job.categories?.commitment),
        description,
        descriptionFormat,
        postedDate: job.createdAt ? new Date(job.createdAt) : undefined,
      };
    });

    const openExternalIds = jobs.map((job) => job.externalId);

    return {
      success: true,
      outcome: "success",
      jobs,
      detectedBoardToken,
      openExternalIds,
      openExternalIdsComplete: true,
    };
  }

  private buildDescription(
    job: LeverJob
  ): { description: string | undefined; descriptionFormat: "markdown" | "plain" } {
    const htmlDescription = this.buildHtmlDescription(job);
    if (htmlDescription) {
      const processed = processDescription(htmlDescription, "html");
      const text = processed.text?.trim();
      if (text) {
        return {
          description: text,
          descriptionFormat: processed.format,
        };
      }
    }

    const plainDescription = this.buildPlainDescription(job);
    if (!plainDescription) {
      return { description: undefined, descriptionFormat: "plain" };
    }

    const processed = processDescription(plainDescription, "plain");
    return {
      description: processed.text ?? undefined,
      descriptionFormat: processed.format,
    };
  }

  private buildHtmlDescription(job: LeverJob): string | null {
    const parts: string[] = [];
    const baseHtml = job.descriptionBody || job.description || job.opening;
    const basePlain =
      job.descriptionBodyPlain || job.descriptionPlain || job.openingPlain;

    const hasListContent = Boolean(
      job.lists?.some((list) => list.content?.trim())
    );
    const hasHtmlContent = Boolean(baseHtml?.trim() || job.additional?.trim() || hasListContent);

    if (!hasHtmlContent) {
      return null;
    }

    if (baseHtml?.trim()) {
      parts.push(baseHtml.trim());
    } else if (basePlain?.trim()) {
      parts.push(`<p>${escapeHtml(basePlain.trim())}</p>`);
    }

    if (job.lists?.length) {
      for (const list of job.lists) {
        const title = list.text?.trim();
        const content = list.content?.trim();

        if (!title && !content) {
          continue;
        }

        if (title) {
          parts.push(`<h3>${escapeHtml(title)}</h3>`);
        }

        if (content) {
          parts.push(normalizeListHtml(content));
        }
      }
    }

    if (job.additional?.trim()) {
      parts.push(job.additional.trim());
    } else if (job.additionalPlain?.trim()) {
      parts.push(`<p>${escapeHtml(job.additionalPlain.trim())}</p>`);
    }

    return parts.length ? parts.join("\n\n") : null;
  }

  private buildPlainDescription(job: LeverJob): string | null {
    const parts: string[] = [];
    const basePlain =
      job.descriptionBodyPlain || job.descriptionPlain || job.openingPlain;

    if (basePlain?.trim()) {
      parts.push(basePlain.trim());
    }

    if (job.additionalPlain?.trim()) {
      parts.push(job.additionalPlain.trim());
    }

    return parts.length ? parts.join("\n\n") : null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeListHtml(content: string): string {
  const trimmed = content.trim();
  const hasWrapper =
    /<(ul|ol)[\s>]/i.test(trimmed) || /<\/(ul|ol)>/i.test(trimmed);

  if (!hasWrapper && /<li[\s>]/i.test(trimmed)) {
    return `<ul>${trimmed}</ul>`;
  }

  return trimmed;
}

export function createLeverScraper(
  httpClient: IHttpClient,
  config?: Partial<LeverConfig>
): LeverScraper {
  return new LeverScraper(httpClient, config);
}
