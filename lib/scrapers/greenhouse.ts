import { AbstractScraper, ScraperResult, ScrapeOptions } from "./base-scraper";
import { processDescription, containsHtml, decodeHtmlEntities } from "@/lib/jobs/description-processor";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location: { name: string };
  departments: { name: string }[];
  updated_at: string;
  content?: string;
  metadata?: { name: string; value: string | string[] }[];
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
      // Extract location from metadata - look for any entry containing location
      const locationMetadata = job.metadata?.find((m: { name: string; value: string | string[] }) => 
        m.name.toLowerCase().includes("location") || 
        m.name.toLowerCase().includes("posting")
      );
      const actualLocations = locationMetadata?.value || [];
      const metadataLocation = Array.isArray(actualLocations) ? actualLocations.join(", ") : (typeof actualLocations === "string" ? actualLocations : "");
      
      // Combine original location with metadata location for comprehensive data
      const originalLocation = job.location?.name || "";
      const locationParts = [originalLocation, metadataLocation].filter(Boolean);
      const combinedLocation = locationParts.join(", ");
      
      const { location, locationType } = this.normalizeLocation(combinedLocation);
      
      // Check if the content is already markdown or contains HTML
      let description: string | undefined;
      let descriptionFormat: "markdown" | "plain" = "plain";
      
      if (job.content) {
        // First decode HTML entities that might be in the content
        const decodedContent = decodeHtmlEntities(job.content);
        
        // If content contains HTML tags, process as HTML and convert to markdown
        if (containsHtml(decodedContent)) {
          const result = processDescription(decodedContent, "html");
          description = result.text ?? undefined;
          descriptionFormat = result.format;
        } else {
          // Content appears to be plain text or markdown already
          description = decodedContent;
          descriptionFormat = "markdown";
        }
      }

      return {
        externalId: this.generateExternalId(this.platform, boardToken, job.id),
        title: job.title,
        url: job.absolute_url,
        location,
        locationType,
        department: job.departments?.[0]?.name,
        description,
        descriptionFormat,
        postedDate: job.updated_at ? new Date(job.updated_at) : undefined,
      };
    });

    return {
      success: true,
      jobs,
    };
  }
}
