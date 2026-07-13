import type { EarlyFilterStats, JobFilters } from "@/lib/scraper/types";
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
}: ListingSelectionOptions<T>): ListingSelection<T> {
  const candidates = listings.map((listing) => ({
    listing,
    ...toFilterable(listing),
  }));
  const filtered = applyEarlyFilters(candidates, filters);
  const selected = filtered.filtered
    .map((candidate) => candidate.listing)
    .filter((listing) => {
      if (!existingExternalIds || existingExternalIds.size === 0) {
        return true;
      }

      const externalId = getExternalId(listing);
      return Boolean(externalId && !existingExternalIds.has(externalId));
    });

  return {
    listings: selected,
    earlyFiltered: toEarlyFilterStats(filtered),
  };
}
