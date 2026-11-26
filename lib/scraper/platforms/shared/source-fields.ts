import type { LocationType } from "@/lib/scraper/types";

export function parseWorkplaceType(value?: string | null): LocationType | undefined {
  switch (value?.toLowerCase().replace(/[\s_-]/g, "")) {
    case "remote": return "remote";
    case "hybrid": return "hybrid";
    case "onsite": return "onsite";
    default: return undefined;
  }
}

export function parseSourceDate(value?: string | number | null): Date | undefined {
  if (value == null || value === "") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

export function sourceLocations(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function formatSalaryRange(range?: {
  min?: number | null;
  max?: number | null;
  currency?: string | null;
  interval?: string | null;
} | null): string | undefined {
  if (!range || (range.min == null && range.max == null)) return undefined;
  return [range.min == null ? `Up to ${range.max}` : range.max == null ? `From ${range.min}`
    : `${range.min} - ${range.max}`, range.currency, range.interval].filter(Boolean).join(" ");
}
