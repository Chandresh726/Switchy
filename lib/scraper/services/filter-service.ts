import type { ScrapedJob, JobFilters } from "@/lib/scraper/types";
import { COUNTRY_MAPPINGS } from "@/lib/scraper/utils";

export type { JobFilters } from "@/lib/scraper/types";

export { COUNTRY_MAPPINGS } from "@/lib/scraper/utils";

export interface FilterResult {
  filtered: ScrapedJob[];
  filteredOut: number;
  breakdown: FilterBreakdown;
}

export interface FilterBreakdown {
  total: number;
  passedCountry: number;
  failedCountry: number;
  passedCity: number;
  failedCity: number;
  passedTitle: number;
  failedTitle: number;
  finalCount: number;
}

export interface IFilterService {
  applyFilters(jobs: ScrapedJob[], filters: JobFilters): FilterResult;
  matchesFilters(job: ScrapedJob, filters: JobFilters): boolean;
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesPreferredCountry(location: string | undefined, preferredCountry: string): boolean {
  if (!location) return false;

  const locationLower = location.toLowerCase().trim();
  const countryLower = preferredCountry.toLowerCase().trim();

  if (
    locationLower === "remote" ||
    locationLower === "remote position" ||
    locationLower === "worldwide" ||
    locationLower === "anywhere"
  ) {
    return true;
  }

  const variations = COUNTRY_MAPPINGS[countryLower] || [countryLower];

  return variations.some((variant) => {
    const regex = new RegExp(`\\b${escapeRegExp(variant)}\\b`, "i");
    return regex.test(locationLower);
  });
}

export function matchesPreferredCity(location: string | undefined, preferredCity: string): boolean {
  if (!preferredCity) return true;
  if (!location) return false;

  const locationLower = location.toLowerCase().trim();
  const cityLower = preferredCity.toLowerCase().trim();

  return locationLower.includes(cityLower);
}

export function matchesTitleKeywords(title: string | undefined, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const titleLower = (title ?? "").toLowerCase();
  return keywords.some((keyword) => titleLower.includes(keyword.toLowerCase()));
}

export class DefaultFilterService implements IFilterService {
  matchesFilters(job: ScrapedJob, filters: JobFilters): boolean {
    if (filters.country && !matchesPreferredCountry(job.location, filters.country)) {
      return false;
    }

    if (filters.city && !matchesPreferredCity(job.location, filters.city)) {
      return false;
    }

    if (filters.titleKeywords && filters.titleKeywords.length > 0) {
      if (!matchesTitleKeywords(job.title, filters.titleKeywords)) {
        return false;
      }
    }

    return true;
  }

  applyFilters(jobs: ScrapedJob[], filters: JobFilters): FilterResult {
    const total = jobs.length;
    const hasFilters = filters.country || filters.city || (filters.titleKeywords && filters.titleKeywords.length > 0);

    if (!hasFilters) {
      return {
        filtered: jobs,
        filteredOut: 0,
        breakdown: {
          total,
          passedCountry: total,
          failedCountry: 0,
          passedCity: total,
          failedCity: 0,
          passedTitle: total,
          failedTitle: 0,
          finalCount: total,
        },
      };
    }

    const breakdown: FilterBreakdown = {
      total,
      passedCountry: 0,
      failedCountry: 0,
      passedCity: 0,
      failedCity: 0,
      passedTitle: 0,
      failedTitle: 0,
      finalCount: 0,
    };

    const filtered: ScrapedJob[] = [];

    for (const job of jobs) {
      let passed = true;

      if (filters.country) {
        if (matchesPreferredCountry(job.location, filters.country)) {
          breakdown.passedCountry++;
        } else {
          breakdown.failedCountry++;
          passed = false;
          continue;
        }
      } else {
        breakdown.passedCountry++;
      }

      if (filters.city) {
        if (matchesPreferredCity(job.location, filters.city)) {
          breakdown.passedCity++;
        } else {
          breakdown.failedCity++;
          passed = false;
          continue;
        }
      } else {
        breakdown.passedCity++;
      }

      if (filters.titleKeywords && filters.titleKeywords.length > 0) {
        if (matchesTitleKeywords(job.title, filters.titleKeywords)) {
          breakdown.passedTitle++;
        } else {
          breakdown.failedTitle++;
          passed = false;
          continue;
        }
      } else {
        breakdown.passedTitle++;
      }

      if (passed) {
        filtered.push(job);
        breakdown.finalCount++;
      }
    }

    return {
      filtered,
      filteredOut: total - breakdown.finalCount,
      breakdown,
    };
  }
}

export function createFilterService(): IFilterService {
  return new DefaultFilterService();
}

export function parseTitleKeywords(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}
