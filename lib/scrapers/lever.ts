import { AbstractScraper, ScraperResult, ScrapeOptions } from "./base-scraper";

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  categories: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
  };
  descriptionPlain?: string;
  createdAt: number;
}

export class LeverScraper extends AbstractScraper {
  platform = "lever";

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return urlLower.includes("lever.co") || urlLower.includes("jobs.lever");
  }

  private extractCompanySlug(url: string): string | null {
    // Handle various Lever URL formats
    // https://jobs.lever.co/company
    // https://company.lever.co

    const patterns = [
      /jobs\.lever\.co\/([^\/\?]+)/i,
      /([^\.]+)\.lever\.co/i,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1] && match[1] !== "jobs") {
        return match[1];
      }
    }

    return null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      // Use manual board token if provided, otherwise extract from URL
      const companySlug = options?.boardToken || this.extractCompanySlug(url);

      if (!companySlug) {
        return {
          success: false,
          jobs: [],
          error: "Could not extract company slug from URL. Please provide the board token manually.",
        };
      }

      // Lever has a JSON API at /v0/postings/company
      const apiUrl = `https://api.lever.co/v0/postings/${companySlug}?mode=json`;

      const response = await this.fetchWithRetry(apiUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      if (!response.ok) {
        return {
          success: false,
          jobs: [],
          error: `Failed to fetch jobs: ${response.status}`,
        };
      }

      const data: LeverJob[] = await response.json();
      return this.parseJobs(data, companySlug);
    } catch (error) {
      return {
        success: false,
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private parseJobs(data: LeverJob[], companySlug: string): ScraperResult {
    const jobs = data.map((job) => {
      const { location, locationType } = this.normalizeLocation(
        job.categories?.location
      );

      return {
        externalId: this.generateExternalId(this.platform, companySlug, job.id),
        title: job.text,
        url: job.hostedUrl,
        location,
        locationType,
        department: job.categories?.team || job.categories?.department,
        employmentType: job.categories?.commitment,
        description: job.descriptionPlain,
        descriptionFormat: "plain" as const,
        postedDate: job.createdAt ? new Date(job.createdAt) : undefined,
      };
    });

    return {
      success: true,
      jobs,
    };
  }
}
