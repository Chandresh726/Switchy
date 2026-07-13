import { z } from "zod";

import { PLATFORMS, type Platform } from "./platform";
import type { ScrapedJob } from "./job";

export type ScrapeOutcome = "success" | "partial" | "error";
export type ListingCompleteness = "complete" | "partial" | "unknown";

export type ScraperErrorCode =
  | "invalid_url"
  | "board_not_found"
  | "rate_limited"
  | "network_error"
  | "parse_error"
  | "auth_required"
  | "browser_error"
  | "csrf_error"
  | "timeout"
  | "cancelled"
  | "unknown";

export interface ScraperError {
  code: ScraperErrorCode;
  message: string;
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
}

export function createScraperError(
  code: ScraperErrorCode,
  message: string,
  metadata: Pick<ScraperError, "statusCode" | "retryAfterMs"> = {}
): ScraperError {
  const retryable = ["rate_limited", "network_error", "timeout", "browser_error"].includes(code);
  return { code, message, retryable, ...metadata };
}

export interface ScraperMetadata {
  detectedBoardToken?: string;
  platform: Platform;
  durationMs: number;
  jobsFiltered?: number;
}

export interface EarlyFilterStats {
  total: number;
  country?: number;
  city?: number;
  title?: number;
}

interface ScraperResultBase<T extends ScrapedJob> {
  jobs: T[];
  metadata?: ScraperMetadata;
  detectedBoardToken?: string;
  earlyFiltered?: EarlyFilterStats;
}

type ListingContract =
  | {
      listingCompleteness: "complete";
      openExternalIds: string[];
    }
  | {
      listingCompleteness: "partial" | "unknown";
      openExternalIds?: string[];
    };

interface ScraperNonErrorResult<T extends ScrapedJob> extends ScraperResultBase<T> {
  totalListings: number;
}

export type ScraperSuccessResult<T extends ScrapedJob = ScrapedJob> =
  ScraperNonErrorResult<T> & ListingContract & {
  outcome: "success";
  error?: never;
};

export type ScraperPartialResult<T extends ScrapedJob = ScrapedJob> =
  ScraperNonErrorResult<T> & ListingContract & {
  outcome: "partial";
  issues?: ScraperError[];
  error?: never;
};

export interface ScraperErrorResult extends ScraperResultBase<never> {
  outcome: "error";
  jobs: [];
  listingCompleteness: "unknown";
  openExternalIds?: never;
  error: ScraperError;
}

export type ScraperResult<T extends ScrapedJob = ScrapedJob> =
  | ScraperSuccessResult<T>
  | ScraperPartialResult<T>
  | ScraperErrorResult;

export function createScraperFailure(
  code: ScraperErrorCode,
  message: string,
  metadata: Pick<ScraperError, "statusCode" | "retryAfterMs"> = {}
): ScraperErrorResult {
  return {
    outcome: "error",
    jobs: [],
    listingCompleteness: "unknown",
    error: createScraperError(code, message, metadata),
  };
}

export const FetchResultSchema = z.object({
  companyId: z.number(),
  companyName: z.string(),
  success: z.boolean(),
  outcome: z.enum(["success", "partial", "error"]),
  skipped: z.boolean().optional(),
  skippedReason: z.string().optional(),
  jobsFound: z.number(),
  jobsAdded: z.number(),
  jobsUpdated: z.number(),
  jobsFiltered: z.number(),
  jobsArchived: z.number(),
  platform: z.enum(PLATFORMS).nullable(),
  error: z.string().optional(),
  retryable: z.boolean().optional(),
  retryAfterMs: z.number().optional(),
  duration: z.number(),
  logId: z.number().optional(),
});

export type FetchResult = z.infer<typeof FetchResultSchema>;

export interface BatchFetchResult {
  sessionId: string;
  results: FetchResult[];
  summary: {
    totalCompanies: number;
    successfulCompanies: number;
    skippedCompanies: number;
    failedCompanies: number;
    totalJobsFound: number;
    totalJobsAdded: number;
    totalJobsFiltered: number;
    totalJobsArchived: number;
    totalDuration: number;
  };
}

export interface SessionProgress {
  companiesCompleted: number;
  totalJobsFound: number;
  totalJobsAdded: number;
  totalJobsFiltered: number;
  totalJobsArchived: number;
}

export type DeduplicationMatchReason = "externalId" | "url" | "titleSimilarity";

export interface DeduplicationResult {
  isNew: boolean;
  existingJobId?: number;
  similarity: number;
  matchReason?: DeduplicationMatchReason;
}

export interface BatchDeduplicationResult {
  newJobs: ScrapedJob[];
  duplicates: Array<{
    job: ScrapedJob;
    existingJobId: number;
    similarity: number;
    matchReason: DeduplicationMatchReason;
  }>;
}
