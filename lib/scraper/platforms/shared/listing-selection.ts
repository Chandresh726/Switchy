import type { EarlyFilterStats, JobFilters } from "@/lib/scraper/types";
import type { ScrapeOptions } from "@/lib/scraper/types/config";
import { recordScrapeMetric } from "@/lib/scraper/infrastructure/metrics";
import {
  applyEarlyFilters,
  toEarlyFilterStats,
  type FilterableItem,
} from "@/lib/scraper/services/early-filter-service";

export interface ListingSelectionOptions<T> {
  listings: readonly T[];
  filters?: JobFilters;
  existingExternalIds?: ReadonlySet<string>;
  toFilterable: (listing: T) => FilterableItem;
  getExternalId: (listing: T) => string | null | undefined;
  existingJobUrls?: ReadonlySet<string>;
  getUrl?: (listing: T) => string;
  detailRefresh?: ScrapeOptions["detailRefresh"];
}

export interface ListingSelection<T> {
  listings: T[];
  earlyFiltered?: EarlyFilterStats;
}

export function selectListingsForHydration<T>({
  listings,
  filters,
  existingExternalIds,
  toFilterable,
  getExternalId,
  existingJobUrls,
  getUrl,
  detailRefresh,
}: ListingSelectionOptions<T>): ListingSelection<T> {
  const candidates = listings.map((listing) => ({
    listing,
    ...toFilterable(listing),
  }));
  const filtered = applyEarlyFilters(candidates, filters);
  const selected = filtered.filtered
    .map((candidate) => candidate.listing)
    .filter((listing) => {
      if (getUrl && existingJobUrls?.has(getUrl(listing))) return false;
      if (!existingExternalIds || existingExternalIds.size === 0) {
        return true;
      }

      const externalId = getExternalId(listing);
      return Boolean(externalId && !existingExternalIds.has(externalId));
    });

  // Spend the refresh budget only on jobs present in this filtered snapshot.
  // Historical jobs absent from the source cannot consume detail capacity.
  const previousFetch = (listing: T): number | undefined => {
    const id = getExternalId(listing);
    return (id ? detailRefresh?.fetchedAtByIdentity.get(id) : undefined) ??
      (getUrl ? detailRefresh?.fetchedAtByIdentity.get(getUrl(listing)) : undefined);
  };
  const newJobs = selected.filter((listing) => previousFetch(listing) === undefined);
  const refreshJobs = selected.filter((listing) => previousFetch(listing) !== undefined)
    .sort((left, right) => previousFetch(left)! - previousFetch(right)!);
  const maintenance = refreshJobs.slice(0, detailRefresh?.limit ?? 0);
  const allowed = detailRefresh?.reserve?.(maintenance.length) ?? maintenance.length;
  recordScrapeMetric("priorityDetailsSelected", detailRefresh ? newJobs.length : selected.length);
  recordScrapeMetric("maintenanceDetailsSelected", detailRefresh ? Math.min(maintenance.length, allowed) : 0);

  return {
    listings: detailRefresh
      ? [...newJobs, ...maintenance.slice(0, allowed)]
      : selected,
    earlyFiltered: toEarlyFilterStats(filtered),
  };
}
