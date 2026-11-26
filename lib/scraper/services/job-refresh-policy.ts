import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import type { ScrapeOptions } from "@/lib/scraper/types/config";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Identify freshness here; spend the budget after discovering current listings. */
export function selectFreshJobIdentities(
  jobs: ExistingJob[],
  now: Date,
  intervalMs = DAY_MS,
  refreshBudget = 50
): { existingExternalIds: Set<string>; existingJobUrls: Set<string>; detailRefresh: NonNullable<ScrapeOptions["detailRefresh"]> } {
  const fresh = jobs.filter((job) => job.description?.trim() && job.descriptionQuality === "full" &&
    job.detailsFetchedAt && now.getTime() >= job.detailsFetchedAt.getTime() &&
    now.getTime() - job.detailsFetchedAt.getTime() < intervalMs);
  const fetchedAtByIdentity = new Map<string, number>();
  for (const job of jobs) {
    if (!job.description?.trim()) continue;
    const fetchedAt = job.detailsFetchedAt?.getTime() ?? 0;
    if (job.externalId) fetchedAtByIdentity.set(job.externalId, fetchedAt);
    fetchedAtByIdentity.set(job.url, fetchedAt);
  }
  return {
    existingExternalIds: new Set(fresh.flatMap((job) => job.externalId ?? [])),
    existingJobUrls: new Set(fresh.map((job) => job.url)),
    detailRefresh: { fetchedAtByIdentity, limit: Number.isFinite(refreshBudget) ? Math.max(1, Math.floor(refreshBudget)) : 50 },
  };
}
