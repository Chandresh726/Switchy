import type { LocationType } from "../types";

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

export function normalizeLocation(location: string | undefined): {
  location?: string;
  locationType?: LocationType;
} {
  if (!location) return {};

  const locationLower = location.toLowerCase();

  let locationType: LocationType | undefined;
  if (locationLower.includes("remote")) {
    locationType = "remote";
  } else if (locationLower.includes("hybrid")) {
    locationType = "hybrid";
  } else if (location.trim()) {
    locationType = "onsite";
  }

  return {
    location: location.trim(),
    locationType,
  };
}

export function generateExternalId(platform: string, ...parts: (string | number | undefined)[]): string {
  const validParts = parts.filter((p) => p !== undefined && p !== null);
  return `${platform}-${validParts.join("-")}`;
}
