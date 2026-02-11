import { AbstractScraper, ScraperResult, ScrapeOptions } from "./base-scraper";
import { processDescription } from "@/lib/jobs/description-processor";

interface AshbyJob {
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  department?: string;
  team?: string;
  isRemote?: boolean;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  employmentType?: string;
  jobUrl?: string;
  applyUrl?: string;
}

interface AshbyResponse {
  apiVersion: string;
  jobs: AshbyJob[];
}

export class AshbyScraper extends AbstractScraper {
  platform = "ashby";

  validate(url: string): boolean {
    const urlLower = url.toLowerCase();
    // Direct Ashby hosted boards
    if (urlLower.includes("jobs.ashbyhq.com")) {
      return true;
    }
    // For now, do not aggressively claim custom domains here.
    // Custom/white-labeled domains can still target this scraper
    // via explicit platform selection + boardToken.
    return false;
  }

  private extractBoardName(url: string): string | null {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
      if (!path) return null;
      // jobs.ashbyhq.com/OrgSlug or jobs.ashbyhq.com/OrgSlug/anything
      const [boardName] = path.split("/");
      return boardName || null;
    } catch {
      return null;
    }
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult> {
    try {
      const boardName = options?.boardToken || this.extractBoardName(url);

      if (!boardName) {
        return {
          success: false,
          jobs: [],
          error:
            "Could not determine Ashby job board name from URL. Please provide the board token (jobs page name) manually.",
        };
      }

      const apiUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
        boardName
      )}?includeCompensation=true`;

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
          error: `Failed to fetch Ashby jobs: ${response.status}`,
        };
      }

      const data = (await response.json()) as AshbyResponse;
      return this.parseJobs(data, boardName);
    } catch (error) {
      return {
        success: false,
        jobs: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private parseJobs(data: AshbyResponse, boardName: string): ScraperResult {
    const jobs = data.jobs.map((job, index) => {
      // Prefer primary location string, fall back to first secondary location
      const primaryLocation =
        job.location ||
        job.secondaryLocations?.[0]?.location ||
        (job.isRemote ? "Remote" : undefined);

      const { location, locationType } = this.normalizeLocation(primaryLocation);

      let description: string | undefined;
      let descriptionFormat: "markdown" | "plain" | "html" = "plain";

      if (job.descriptionHtml) {
        const processed = processDescription(job.descriptionHtml, "html");
        description = processed.text ?? undefined;
        descriptionFormat = processed.format;
      } else if (job.descriptionPlain) {
        description = job.descriptionPlain;
        descriptionFormat = "plain";
      }

      // Normalise employment type to a friendlier string where possible
      const employmentType =
        job.employmentType === "FullTime"
          ? "full-time"
          : job.employmentType === "PartTime"
          ? "part-time"
          : job.employmentType === "Intern"
          ? "intern"
          : job.employmentType === "Contract"
          ? "contract"
          : job.employmentType === "Temporary"
          ? "temporary"
          : job.employmentType;

      const externalId = this.generateExternalId(
        this.platform,
        boardName,
        job.jobUrl || job.applyUrl || index
      );

      return {
        externalId,
        title: job.title,
        url: job.jobUrl || job.applyUrl || "",
        location,
        locationType,
        department: job.team || job.department,
        description,
        descriptionFormat,
        employmentType,
        postedDate: job.publishedAt ? new Date(job.publishedAt) : undefined,
      };
    });

    return {
      success: true,
      jobs,
    };
  }
}

