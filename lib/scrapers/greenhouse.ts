import { AbstractScraper, ScraperResult, ScrapeOptions } from "./base-scraper";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string };
  departments: { name: string }[];
  updated_at: string;
  content?: string;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

export class GreenhouseScraper extends AbstractScraper {
  platform = "greenhouse";

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    return (
      urlLower.includes("greenhouse.io") ||
      urlLower.includes("boards.greenhouse")
    );
  }

  private extractBoardToken(url: string): string | null {
    // Handle various Greenhouse URL formats
    // https://boards.greenhouse.io/company
    // https://boards.greenhouse.io/company/jobs
    // https://job-boards.greenhouse.io/company
    // https://company.greenhouse.io

    const patterns = [
      /boards\.greenhouse\.io\/([^\/\?]+)/i,
      /job-boards\.greenhouse\.io\/([^\/\?]+)/i,
      /([^\.]+)\.greenhouse\.io/i,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1] && match[1] !== "boards" && match[1] !== "job-boards") {
        return match[1];
      }
    }

    return null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      // Use manual board token if provided, otherwise extract from URL
      const boardToken = options?.boardToken || this.extractBoardToken(url);

      if (!boardToken) {
        return {
          success: false,
          jobs: [],
          error: "Could not extract board token from URL. Please provide the board token manually.",
        };
      }

      // Greenhouse has a JSON API at /embed/job_board/jobs.json
      const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`;

      const response = await this.fetchWithRetry(apiUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
        },
      });

      if (!response.ok) {
        // Try alternative API endpoint
        const altApiUrl = `https://boards.greenhouse.io/${boardToken}/embed/job_board/jobs.json`;
        const altResponse = await this.fetchWithRetry(altApiUrl, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; Switchy/1.0)",
          },
        });

        if (!altResponse.ok) {
          return {
            success: false,
            jobs: [],
            error: `Failed to fetch jobs: ${response.status}`,
          };
        }

        const data: GreenhouseResponse = await altResponse.json();
        return this.parseJobs(data, boardToken);
      }

      const data: GreenhouseResponse = await response.json();
      return this.parseJobs(data, boardToken);
    } catch (error) {
      return {
        success: false,
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private parseJobs(data: GreenhouseResponse, boardToken: string): ScraperResult {
    const jobs = data.jobs.map((job) => {
      const { location, locationType } = this.normalizeLocation(job.location?.name);

      return {
        externalId: this.generateExternalId(this.platform, boardToken, job.id),
        title: job.title,
        url: job.absolute_url,
        location,
        locationType,
        department: job.departments?.[0]?.name,
        description: job.content,
        postedDate: job.updated_at ? new Date(job.updated_at) : undefined,
      };
    });

    return {
      success: true,
      jobs,
    };
  }
}
