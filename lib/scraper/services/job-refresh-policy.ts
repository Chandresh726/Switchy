import type { ExistingJob } from "@/lib/scraper/infrastructure/types";
import type { ScrapeOptions } from "@/lib/scraper/types/config";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Identify freshness here; spend the budget after discovering current listings. */
export function selectFreshJobIdentities(
  jobs: ExistingJob[],
  now: Date,
  intervalMs = DAY_MS,
  refreshBudget = 5
): { existingExternalIds: Set<string>; existingJobUrls: Set<string>; detailRefresh: NonNullable<ScrapeOptions["detailRefresh"]> } {
  const fresh = jobs.filter((job) => job.description?.trim() && job.descriptionQuality === "full" &&
    job.detailsFetchedAt && now.getTime() >= job.detailsFetchedAt.getTime() &&
    now.getTime() - job.detailsFetchedAt.getTime() < staggeredRefreshInterval(job.externalId ?? job.url, intervalMs));
  const fetchedAtByIdentity = new Map<string, number>();
  for (const job of jobs) {
    if (!job.description?.trim() || job.descriptionQuality === "teaser") continue;
    const fetchedAt = job.detailsFetchedAt?.getTime() ?? 0;
    if (job.externalId) fetchedAtByIdentity.set(job.externalId, fetchedAt);
    fetchedAtByIdentity.set(job.url, fetchedAt);
  }
  return {
    existingExternalIds: new Set(fresh.flatMap((job) => job.externalId ?? [])),
    existingJobUrls: new Set(fresh.map((job) => job.url)),
    detailRefresh: { fetchedAtByIdentity, limit: Number.isFinite(refreshBudget) ? Math.max(0, Math.floor(refreshBudget)) : 5 },
  };
}

function staggeredRefreshInterval(identity: string, intervalMs: number): number {
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index++) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  return intervalMs + ((hash >>> 0) / 0x1_0000_0000) * Math.max(0, intervalMs / 4);
}
