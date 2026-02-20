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
    expect(result.duplicates[0]?.matchReason).toBe("externalId");
    expect(result.duplicates[1]?.matchReason).toBe("url");
  });

  it("labels fuzzy title matches with titleSimilarity match reason", () => {
    const service = new TitleBasedDeduplicationService({
      titleSimilarityThreshold: 0.3,
    });
    const existingJobs = [
      {
        id: 1,
        externalId: "greenhouse-acme-1",
        title: "Software Engineer",
        url: "https://jobs.example.com/existing",
        status: "new",
        description: "existing description",
      },
    ];

    const result = service.deduplicate(
      {
        externalId: "greenhouse-acme-2",
        title: "Software Engineer II",
        url: "https://jobs.example.com/new",
      },
      existingJobs
    );

    expect(result.isNew).toBe(false);
    expect(result.existingJobId).toBe(1);
    expect(result.matchReason).toBe("titleSimilarity");
  });
});
