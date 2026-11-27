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

export function readAddressCountry(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const address = record.postalAddress && typeof record.postalAddress === "object"
    ? record.postalAddress as Record<string, unknown> : record;
  return typeof address.addressCountry === "string" ? address.addressCountry : undefined;
}

/** Include secondary locations so a primary country cannot exclude them. */
export function sourceCountryHint(countries: Array<string | null | undefined>, locations: string[]): string | undefined {
  const uniqueLocations = sourceLocations(locations);
  if (uniqueLocations.length === 1 && /^(remote|remote position|worldwide|anywhere)$/i.test(uniqueLocations[0])) return "Remote";
  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  const alpha3: Record<string, string> = { IND: "IN", USA: "US", GBR: "GB", DEU: "DE", CAN: "CA" };
  const labels = countries.flatMap((value) => {
    if (!value?.trim()) return [];
    const code = alpha3[value.toUpperCase()] ?? value.toUpperCase();
    return [/^[A-Z]{2}$/.test(code) ? names.of(code) ?? value : value];
  });
  return sourceLocations([...labels, ...uniqueLocations]).join(" | ") || undefined;
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
