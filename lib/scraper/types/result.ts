import type { Platform } from "./platform";
import type { ScrapedJob } from "./job";

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
  | "unknown";

export interface ScraperError {
  code: ScraperErrorCode;
  message: string;
  cause?: Error;
  retryable: boolean;
}

export function createScraperError(
  code: ScraperErrorCode,
  message: string,
  cause?: Error
): ScraperError {
  const retryable = ["rate_limited", "network_error", "timeout", "browser_error"].includes(code);
  return { code, message, cause, retryable };
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

export interface ScraperResult<T extends ScrapedJob = ScrapedJob> {
  success: boolean;
  jobs: T[];
  error?: string;
  metadata?: ScraperMetadata;
  detectedBoardToken?: string;
  earlyFiltered?: EarlyFilterStats;
  openExternalIds?: string[];
  openExternalIdsComplete?: boolean;
}

export interface FetchResult {
  companyId: number;
  companyName: string;
  success: boolean;
  jobsFound: number;
  jobsAdded: number;
  jobsUpdated: number;
  jobsFiltered: number;
  platform: Platform | null;
  error?: string;
  duration: number;
  logId?: number;
}

export interface BatchFetchResult {
  sessionId: string;
  results: FetchResult[];
  summary: {
    totalCompanies: number;
    successfulCompanies: number;
    failedCompanies: number;
    totalJobsFound: number;
    totalJobsAdded: number;
    totalJobsFiltered: number;
    totalDuration: number;
  };
}

export interface SessionProgress {
  companiesCompleted: number;
  totalJobsFound: number;
  totalJobsAdded: number;
  totalJobsFiltered: number;
}

export interface DeduplicationResult {
  isNew: boolean;
  existingJobId?: number;
  similarity: number;
}

export interface BatchDeduplicationResult {
  newJobs: ScrapedJob[];
  duplicates: Array<{
    job: ScrapedJob;
    existingJobId: number;
    similarity: number;
  }>;
}
