import type { EarlyFilterStats, JobFilters } from "@/lib/scraper/types";
import { formatJobLocation, normalizeJobLocations } from "@/lib/jobs/locations";
import {
  matchesPreferredCity,
  matchesJobCountry,
  matchesTitleKeywords,
} from "./filter-service";

export interface FilterableItem {
  title?: string;
  location?: string;
  country?: string;
  locations?: string[];
  /** Opt in only when listing metadata explicitly defers names to job details. */
  locationsPending?: boolean;
}

interface EarlyFilterBreakdown {
  country: number;
  city: number;
  title: number;
}

export interface EarlyFilterResult<T extends FilterableItem> {
  filtered: T[];
  filteredOut: number;
  breakdown: EarlyFilterBreakdown;
}

function hasEarlyFilters(filters?: JobFilters): boolean {
  return Boolean(
    filters &&
      (filters.country ||
        filters.city ||
        (filters.titleKeywords && filters.titleKeywords.length > 0))
  );
}

export function applyEarlyFilters<T extends FilterableItem>(
  items: T[],
  filters?: JobFilters
): EarlyFilterResult<T> {
  if (!hasEarlyFilters(filters)) {
    return {
      filtered: items,
      filteredOut: 0,
      breakdown: { country: 0, city: 0, title: 0 },
    };
  }

  const safeFilters = filters as JobFilters;
  const breakdown: EarlyFilterBreakdown = { country: 0, city: 0, title: 0 };
  const filtered: T[] = [];

  for (const item of items) {
    const location = formatJobLocation(item.location, item.locations) ?? undefined;
    const pending = item.locationsPending && normalizeJobLocations(item.location, item.locations).length === 0;
    if (safeFilters.country && !(pending && !item.country) &&
        !matchesJobCountry(item, safeFilters.country)) {
      breakdown.country++;
      continue;
    }

    if (safeFilters.city && !pending && !matchesPreferredCity(location, safeFilters.city)) {
      breakdown.city++;
      continue;
    }

    if (
      safeFilters.titleKeywords &&
      safeFilters.titleKeywords.length > 0 &&
      !matchesTitleKeywords(item.title, safeFilters.titleKeywords)
    ) {
      breakdown.title++;
      continue;
    }

    filtered.push(item);
  }

  return {
    filtered,
    filteredOut: items.length - filtered.length,
    breakdown,
  };
}

export function toEarlyFilterStats(result: EarlyFilterResult<FilterableItem>): EarlyFilterStats | undefined {
  if (result.filteredOut <= 0) return undefined;

  return {
    total: result.filteredOut,
    country: result.breakdown.country > 0 ? result.breakdown.country : undefined,
    city: result.breakdown.city > 0 ? result.breakdown.city : undefined,
    title: result.breakdown.title > 0 ? result.breakdown.title : undefined,
  };
}
