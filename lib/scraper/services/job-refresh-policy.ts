import type { ExistingJob } from "@/lib/scraper/infrastructure/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Bound refresh work for old installations without starving newer jobs. */
export function selectFreshJobIdentities(
  jobs: ExistingJob[],
  now: Date,
  intervalMs = DAY_MS,
  refreshBudget = 50
): { existingExternalIds: Set<string>; existingJobUrls: Set<string> } {
  const due = jobs.filter((job) => job.description?.trim() &&
    (job.descriptionQuality !== "full" || !job.detailsFetchedAt ||
      now.getTime() - job.detailsFetchedAt.getTime() >= intervalMs))
    .sort((a, b) => (a.detailsFetchedAt?.getTime() ?? 0) - (b.detailsFetchedAt?.getTime() ?? 0) || a.id - b.id);
  const refreshIds = new Set(due.slice(0, Math.max(1, refreshBudget)).map((job) => job.id));
  const fresh = jobs.filter((job) => job.description?.trim() && !refreshIds.has(job.id));
  return {
    existingExternalIds: new Set(fresh.flatMap((job) => job.externalId ?? [])),
    existingJobUrls: new Set(fresh.map((job) => job.url)),
  };
}
