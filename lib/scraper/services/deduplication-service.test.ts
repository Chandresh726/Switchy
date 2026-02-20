import { describe, expect, it } from "vitest";

import { TitleBasedDeduplicationService } from "@/lib/scraper/services/deduplication-service";
import type { ScrapedJob } from "@/lib/scraper/types";

describe("deduplication service", () => {
  it("deduplicates jobs within the same scraped batch", () => {
    const service = new TitleBasedDeduplicationService();

    const jobs: ScrapedJob[] = [
      {
        externalId: "greenhouse-acme-1",
        title: "Software Engineer",
        url: "https://jobs.example.com/1",
      },
      {
        externalId: "greenhouse-acme-1",
        title: "Software Engineer",
        url: "https://jobs.example.com/1",
      },
      {
        externalId: "greenhouse-acme-2",
        title: "Software Engineer",
        url: "https://jobs.example.com/1",
      },
    ];

    const result = service.batchDeduplicate(jobs, []);

    expect(result.newJobs).toHaveLength(1);
    expect(result.duplicates).toHaveLength(2);
  });
});
