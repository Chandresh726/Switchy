import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { AbstractApiScraper, DEFAULT_API_CONFIG } from "../core";
import type { ScraperResult, ScrapeOptions, ScrapedJob, ApiScraperConfig } from "../core/types";
import { parseEmploymentType, type JobFilters } from "../types";
import { processDescription } from "@/lib/jobs/description-processor";

interface UberLocation {
  country: string;
  region: string | null;
  city: string;
  countryName: string;
}

interface UberJob {
  id: number;
  title: string;
  description: string;
  department: string;
  type: string;
  programAndPlatform: string | null;
  location: UberLocation;
  featured: boolean;
  level: string | null;
  creationDate: string;
  otherLevels: string[] | null;
  team: string;
  portalID: number;
  isPipeline: boolean;
  statusID: number;
  statusName: string;
  updatedDate: string;
  uniqueSkills: string[] | null;
  timeType: string;
  allLocations: UberLocation[] | null;
}

interface UberSearchResponse {
  status: string;
  data: {
    results: UberJob[];
    total: number;
  };
}

export type UberConfig = ApiScraperConfig;

export const DEFAULT_UBER_CONFIG: UberConfig = {
  ...DEFAULT_API_CONFIG,
  baseUrl: "https://www.uber.com",
};

export class UberScraper extends AbstractApiScraper<UberConfig> {
  readonly platform = "uber" as const;

  constructor(
    httpClient: IHttpClient,
    config: Partial<UberConfig> = {}
  ) {
    super(httpClient, { ...DEFAULT_UBER_CONFIG, ...config });
  }

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return (
      urlLower.includes("uber.com/careers") ||
      urlLower.includes("jobs.uber.com") ||
      urlLower.includes("uber.com") && urlLower.includes("career")
    );
  }

  extractIdentifier(url: string): string | null {
    const patterns = [
      /uber\.com\/([a-z]{2})\//i,
      /uber\.com\/([a-z]+)\//i,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return "global";
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const filters = options?.filters;

      const allJobs: UberJob[] = [];
      let page = 0;
      const limit = 100;
      let hasMore = true;

      while (hasMore) {
        const apiUrl = `${this.config.baseUrl}/api/loadSearchJobsResults?localeCode=en`;

        const response = await this.httpClient.fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": "x",
            "Accept": "application/json",
          },
          body: JSON.stringify({
            page,
            limit,
            filter: {}, // Fetch all, filter client-side
          }),
          timeout: this.config.timeout,
          retries: this.config.retries,
          baseDelay: this.config.baseDelay,
        });

        if (!response.ok) {
          return {
            success: false,
            jobs: [],
            error: `Failed to fetch jobs: ${response.status}`,
          };
        }

        const data: UberSearchResponse = await response.json();

        if (data.status !== "success" || !data.data) {
          return {
            success: false,
            jobs: [],
            error: "Invalid response from Uber API",
          };
        }

        allJobs.push(...data.data.results);

        if (data.data.results.length < limit) {
          hasMore = false;
        } else {
          page++;
          // Rate limiting: 500ms delay between calls
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      return this.parseJobs(allJobs, filters);
    } catch (error) {
      return {
        success: false,
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private parseJobs(
    jobs: UberJob[],
    filters: JobFilters | undefined
  ): ScraperResult {
    const filteredJobs: ScrapedJob[] = [];
    let filteredOutCount = 0;
    let countryFiltered = 0;
    let cityFiltered = 0;
    let titleFiltered = 0;

    for (const job of jobs) {
      const locationStr = this.formatLocation(job.location, job.allLocations);
      const { location, locationType } = this.normalizeLocation(locationStr);

      // Apply filters client-side
      if (filters) {
        let passesFilters = true;

        if (filters.country) {
          const countryLower = filters.country.toLowerCase();
          const locationLower = location?.toLowerCase() || "";
          const countryMappings: Record<string, string[]> = {
            "united states": ["usa", "us", "united states", "america"],
            "india": ["india", "ind"],
            "united kingdom": ["uk", "united kingdom", "britain", "england"],
            "canada": ["canada", "ca"],
            "australia": ["australia", "au"],
            "germany": ["germany", "de"],
            "france": ["france", "fr"],
            "netherlands": ["netherlands", "nl"],
            "singapore": ["singapore", "sg"],
            "japan": ["japan", "jp"],
            "brazil": ["brazil", "br"],
            "mexico": ["mexico", "mx"],
          };

          const variations = countryMappings[countryLower] || [countryLower];
          const matchesCountry = variations.some((variant) =>
            locationLower.includes(variant.toLowerCase())
          );

          if (!matchesCountry && locationLower !== "remote") {
            passesFilters = false;
            countryFiltered++;
          }
        }

        if (passesFilters && filters.city) {
          const cityLower = filters.city.toLowerCase();
          const locationLower = location?.toLowerCase() || "";
          if (!locationLower.includes(cityLower)) {
            passesFilters = false;
            cityFiltered++;
          }
        }

        if (passesFilters && filters.titleKeywords && filters.titleKeywords.length > 0) {
          const titleLower = job.title.toLowerCase();
          const matchesKeyword = filters.titleKeywords.some((keyword) =>
            titleLower.includes(keyword.toLowerCase())
          );
          if (!matchesKeyword) {
            passesFilters = false;
            titleFiltered++;
          }
        }

        if (!passesFilters) {
          filteredOutCount++;
          continue;
        }
      }

      const { text: description, format: descriptionFormat } = processDescription(
        job.description || "",
        "plain"
      );

      filteredJobs.push({
        externalId: this.generateExternalId(this.platform, String(job.id)),
        title: job.title,
        url: `https://www.uber.com/global/en/careers/list/${job.id}/`,
        location,
        locationType,
        department: job.team || job.department,
        description: description || undefined,
        descriptionFormat,
        employmentType: parseEmploymentType(job.timeType),
        seniorityLevel: this.mapLevel(job.level) as "entry" | "mid" | "senior" | "lead" | "manager" | undefined,
        postedDate: new Date(job.creationDate),
      });
    }

    const allExternalIds = jobs.map((job) =>
      this.generateExternalId(this.platform, String(job.id))
    );

    const result: ScraperResult = {
      success: true,
      jobs: filteredJobs,
      openExternalIds: allExternalIds,
      openExternalIdsComplete: true,
    };

    if (filteredOutCount > 0) {
      result.earlyFiltered = {
        total: filteredOutCount,
        country: countryFiltered > 0 ? countryFiltered : undefined,
        city: cityFiltered > 0 ? cityFiltered : undefined,
        title: titleFiltered > 0 ? titleFiltered : undefined,
      };
    }

    return result;
  }

  private formatLocation(
    primaryLocation: UberLocation,
    allLocations: UberLocation[] | null
  ): string {
    const formatSingleLocation = (loc: UberLocation): string => {
      const parts = [loc.city];
      if (loc.region && loc.region !== loc.city) {
        parts.push(loc.region);
      }
      parts.push(loc.countryName);
      return parts.join(", ");
    };

    if (allLocations && allLocations.length > 1) {
      // Multi-location job
      const uniqueLocations = allLocations.map(formatSingleLocation);
      return uniqueLocations.join("; ");
    }

    return formatSingleLocation(primaryLocation);
  }

  private mapLevel(level: string | null): string | undefined {
    if (!level) return undefined;

    const levelLower = level.toLowerCase();

    if (levelLower.includes("senior") || levelLower.includes("sr ")) {
      return "senior";
    }
    if (levelLower.includes("staff") || levelLower.includes("principal")) {
      return "lead";
    }
    if (levelLower.includes("manager") || levelLower.includes("director")) {
      return "manager";
    }
    if (levelLower.includes("entry") || levelLower.includes("junior") || levelLower.includes("jr ")) {
      return "entry";
    }

    return "mid";
  }
}

export function createUberScraper(
  httpClient: IHttpClient,
  config?: Partial<UberConfig>
): UberScraper {
  return new UberScraper(httpClient, config);
}
