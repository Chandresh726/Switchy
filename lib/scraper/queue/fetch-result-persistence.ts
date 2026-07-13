import {
  FetchResultSchema,
  isPlatform,
  type FetchResult,
} from "@/lib/scraper/types";

export interface CommittedScrapeResult {
  companyId: number;
  companyName: string | null;
  logId: number;
  status: "success" | "partial";
  jobsFound: number | null;
  jobsAdded: number | null;
  jobsUpdated: number | null;
  jobsFiltered: number | null;
  jobsArchived: number | null;
  platform: string | null;
  duration: number | null;
  errorMessage: string | null;
}

export function createFetchResultFromCommittedScrape(
  committed: CommittedScrapeResult
): FetchResult {
  const outcome = committed.status;
  return {
    companyId: committed.companyId,
    companyName: committed.companyName ?? "Unknown",
    success: outcome === "success",
    outcome,
    jobsFound: committed.jobsFound ?? 0,
    jobsAdded: committed.jobsAdded ?? 0,
    jobsUpdated: committed.jobsUpdated ?? 0,
    jobsFiltered: committed.jobsFiltered ?? 0,
    jobsArchived: committed.jobsArchived ?? 0,
    platform:
      committed.platform && isPlatform(committed.platform)
        ? committed.platform
        : null,
    duration: committed.duration ?? 0,
    warnings: committed.errorMessage ? [committed.errorMessage] : undefined,
    logId: committed.logId,
  };
}

export function serializeFetchResult(result: FetchResult): string {
  return JSON.stringify(FetchResultSchema.parse(result));
}

export function parseFetchResult(
  resultJson: string,
  expectedCompanyId: number
): FetchResult | null {
  try {
    const parsed = FetchResultSchema.safeParse(JSON.parse(resultJson));
    if (!parsed.success || parsed.data.companyId !== expectedCompanyId) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
