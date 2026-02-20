import type { EarlyFilterStats, JobFilters } from "@/lib/scraper/types";
import {
  matchesPreferredCity,
  matchesPreferredCountry,
  matchesTitleKeywords,
} from "./filter-service";

export interface FilterableItem {
  title?: string;
  location?: string;
}

export interface EarlyFilterBreakdown {
  country: number;
  city: number;
  title: number;
}

export interface EarlyFilterResult<T extends FilterableItem> {
  filtered: T[];
  filteredOut: number;
  breakdown: EarlyFilterBreakdown;
}

export function hasEarlyFilters(filters?: JobFilters): boolean {
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
    if (safeFilters.country && !matchesPreferredCountry(item.location, safeFilters.country)) {
      breakdown.country++;
      continue;
    }

    if (safeFilters.city && !matchesPreferredCity(item.location, safeFilters.city)) {
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
