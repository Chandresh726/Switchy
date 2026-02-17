export const COUNTRY_MAPPINGS: Record<string, string[]> = {
  india: [
    "india",
    "ind",
    "bangalore",
    "bengaluru",
    "mumbai",
    "delhi",
    "hyderabad",
    "chennai",
    "pune",
    "kolkata",
    "gurugram",
    "gurgaon",
    "noida",
    "ahmedabad",
    "jaipur",
    "kochi",
    "thiruvananthapuram",
    "sez",
  ],
  "united states": [
    "usa",
    "us",
    "u.s.",
    "united states",
    "america",
    "new york",
    "san francisco",
    "seattle",
    "los angeles",
    "chicago",
    "austin",
    "boston",
    "denver",
  ],
  "united kingdom": [
    "uk",
    "u.k.",
    "britain",
    "england",
    "united kingdom",
    "london",
    "manchester",
    "edinburgh",
    "birmingham",
  ],
  germany: ["germany", "deutschland", "berlin", "munich", "frankfurt", "hamburg"],
  canada: ["canada", "toronto", "vancouver", "montreal", "ottawa", "calgary"],
};

export interface JobFilterOptions {
  country?: string;
  city?: string;
  titleKeywords?: string[];
}

export interface FilterableJob {
  title?: string;
  location?: string;
}

export function matchesPreferredCountry(
  location: string | undefined,
  preferredCountry: string
): boolean {
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
    const regex = new RegExp(`\\b${variant}\\b`, "i");
    return regex.test(locationLower);
  });
}

export function matchesPreferredCity(
  location: string | undefined,
  preferredCity: string
): boolean {
  if (!preferredCity) return true;
  if (!location) return false;

  const locationLower = location.toLowerCase().trim();
  const cityLower = preferredCity.toLowerCase().trim();

  return locationLower.includes(cityLower);
}

export function parseTitleKeywordsFilter(value: string | null | undefined): string[] {
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

export function matchesTitleKeywords(
  title: string | undefined,
  keywords: string[]
): boolean {
  if (keywords.length === 0) return true;
  const titleLower = (title ?? "").toLowerCase();
  return keywords.some((keyword) => titleLower.includes(keyword));
}

export function matchesFilters(
  job: FilterableJob,
  filters: JobFilterOptions
): boolean {
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

export function applyFilters<T extends FilterableJob>(
  jobs: T[],
  filters: JobFilterOptions
): { filtered: T[]; filteredOut: number } {
  if (!filters.country && !filters.city && (!filters.titleKeywords || filters.titleKeywords.length === 0)) {
    return { filtered: jobs, filteredOut: 0 };
  }

  const originalCount = jobs.length;
  const filtered = jobs.filter((job) => matchesFilters(job, filters));
  
  return {
    filtered,
    filteredOut: originalCount - filtered.length,
  };
}
