import { z } from "zod";

import { processDescription } from "@/lib/jobs/description-processor";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { createScraperError, parseEmploymentType, parseExternalItems, parseExternalPayload } from "@/lib/scraper/types";

import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import { formatSalaryRange, parseSourceDate, parseWorkplaceType } from "./shared/source-fields";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig } from "../core/types";

type LeverJob = z.infer<typeof LeverJobSchema>;

const LeverJobSchema = z
    .object({
      id: z.string().min(1),
      text: z.string().min(1),
      hostedUrl: z.string().min(1),
      categories: z
        .object({
          location: z.string().nullish(),
          team: z.string().nullish(),
          department: z.string().nullish(),
          commitment: z.string().nullish(),
        })
        .passthrough()
        .nullish(),
      description: z.string().nullish(),
      descriptionBody: z.string().nullish(),
      descriptionBodyPlain: z.string().nullish(),
      descriptionPlain: z.string().nullish(),
      additional: z.string().nullish(),
      additionalPlain: z.string().nullish(),
      opening: z.string().nullish(),
      openingPlain: z.string().nullish(),
      lists: z
        .array(
          z.object({ text: z.string().nullish(), content: z.string().nullish() }).passthrough()
        )
        .nullish(),
      createdAt: z.number().nullish(),
      workplaceType: z.string().nullish(),
      country: z.string().nullish(),
      salaryRange: z.object({ min: z.number().nullish(), max: z.number().nullish(), currency: z.string().nullish(), interval: z.string().nullish() }).passthrough().nullish(),
    })
    .passthrough();

export type LeverConfig = ApiScraperConfig & { listingPageSize: number; maxListingPages: number };

const DEFAULT_LEVER_CONFIG: LeverConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://api.lever.co",
  listingPageSize: 100,
  maxListingPages: 100,
};

export class LeverScraper extends AbstractApiScraper<LeverConfig> {
  readonly platform = "lever" as const;

  constructor(
    httpClient: IHttpClient,
    config: Partial<LeverConfig> = {}
  ) {
    super(httpClient, { ...DEFAULT_LEVER_CONFIG, ...config });
  }

  extractIdentifier(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "jobs.lever.co" || parsed.hostname === "jobs.eu.lever.co") {
        return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
      }
      const match = parsed.hostname.match(/^([^.]+)\.lever\.co$/i);
      return match && !["jobs", "api"].includes(match[1]) ? match[1] : null;
    } catch { return null; }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const companySlug = options?.boardToken || this.extractIdentifier(url);
      const detectedBoardToken = !options?.boardToken && companySlug ? companySlug : undefined;

      if (!companySlug) {
        return this.failure(
          "invalid_url",
          "Could not extract company slug from URL. Please provide the board token manually."
        );
      }

      const apiBase = new URL(url).hostname.endsWith(".eu.lever.co") ? "https://api.eu.lever.co" : this.config.baseUrl;
      const payload: unknown[] = [];
      const pageSignatures = new Set<string>();
      let complete = false;
      let listingIssue: ReturnType<typeof createScraperError> | undefined;
      for (let page = 0; page < this.config.maxListingPages; page++) {
        const apiUrl = `${apiBase}/v0/postings/${encodeURIComponent(companySlug)}?mode=json&limit=${this.config.listingPageSize}&skip=${page * this.config.listingPageSize}`;
        const response = await this.fetchResponse(apiUrl, { headers: this.jsonRequestHeaders() });
        if (!response.ok) {
          const failure = this.failureForResponse(response, `Failed to fetch Lever listings: ${response.status}`);
          if (page === 0) return failure;
          listingIssue = failure.error;
          break;
        }
        const entries = parseExternalPayload(z.array(z.unknown()), await response.json(), "Lever");
        const signature = JSON.stringify(entries.map((entry) => entry && typeof entry === "object" && "id" in entry ? entry.id : entry));
        if (entries.length > 0 && pageSignatures.has(signature)) break;
        pageSignatures.add(signature);
        payload.push(...entries);
        if (entries.length < this.config.listingPageSize) { complete = true; break; }
      }
      const parsed = parseExternalItems(LeverJobSchema, payload, "Lever jobs");
      const result = this.parseJobs(parsed.items, companySlug, detectedBoardToken, payload.length, parsed.invalidCount);
      if (result.outcome === "error" || complete) return result;
      return { ...result, outcome: "partial", listingCompleteness: "partial",
        issues: [...(result.issues ?? []), listingIssue ?? createScraperError("network_error", "Lever pagination did not reach a confirmed final page.")] };
    } catch (error) {
      return this.failureFromUnknown(error);
    }
  }

  private parseJobs(
    data: LeverJob[],
    companySlug: string,
    detectedBoardToken?: string,
    totalListings = data.length,
    invalidCount = 0
  ): ScraperResult {
    const jobs: ScrapedJob[] = data.map((job) => {
      const { location, locationType } = this.normalizeLocation(
        [job.categories?.location, job.country].filter(Boolean).join(", ")
      );
      const { description, descriptionFormat } = this.buildDescription(job);

      return {
        externalId: this.generateExternalId(this.platform, companySlug, job.id),
        title: job.text,
        url: job.hostedUrl,
        location,
        locationType: parseWorkplaceType(job.workplaceType) ?? locationType,
        salary: formatSalaryRange(job.salaryRange),
        department: job.categories?.team || job.categories?.department || undefined,
        employmentType: parseEmploymentType(job.categories?.commitment ?? undefined),
        description,
        descriptionFormat,
        postedDate: parseSourceDate(job.createdAt),
      };
    });

    const openExternalIds = jobs.map((job) => job.externalId);

    return {
      outcome: invalidCount > 0 ? "partial" : "success",
      jobs,
      totalListings,
      detectedBoardToken,
      openExternalIds,
      listingCompleteness: invalidCount > 0 ? "partial" : "complete",
      issues: invalidCount ? [createScraperError("parse_error", `${invalidCount} Lever listings had invalid required fields.`)] : undefined,
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
    if (job.opening && job.descriptionBody && job.opening !== job.descriptionBody) parts.push(job.opening);
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
    if (job.openingPlain && job.descriptionBodyPlain && job.openingPlain !== job.descriptionBodyPlain) parts.push(job.openingPlain);
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
