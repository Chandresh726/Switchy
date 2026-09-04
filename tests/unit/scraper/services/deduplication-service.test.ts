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
        externalId: "existing-external-id",
        title: "Software Engineer",
        url: "https://jobs.example.com/existing",
        location: "Remote",
        status: "new",
        description: "existing description",
      },
    ];

    const result = service.deduplicate(
      {
        externalId: "",
        title: "Software Engineer II",
        url: "https://jobs.example.com/new",
        location: "Remote",
      },
      existingJobs
    );

    expect(result.isNew).toBe(false);
    expect(result.existingJobId).toBe(1);
    expect(result.matchReason).toBe("titleSimilarity");
  });

  it("treats missing or mismatched locations as non-matches for fuzzy titles", () => {
    const service = new TitleBasedDeduplicationService({
      titleSimilarityThreshold: 0.3,
    });
    const existingJobs = [
      {
        id: 1,
        externalId: "",
        title: "Software Engineer",
        url: "https://jobs.example.com/existing",
        location: "New York, NY",
        status: "new",
        description: "existing description",
      },
    ];

    const missingLocation = service.deduplicate(
      {
        externalId: "",
        title: "Software Engineer",
        url: "https://jobs.example.com/new",
      },
      existingJobs
    );
    expect(missingLocation.isNew).toBe(true);

    const yorkVsNewYork = service.deduplicate(
      {
        externalId: "",
        title: "Software Engineer",
        url: "https://jobs.example.com/new-2",
        location: "York",
      },
      existingJobs
    );
    expect(yorkVsNewYork.isNew).toBe(true);
  });

  it("does not collapse distinct Greenhouse jobs with different external IDs into a fuzzy duplicate", () => {
    const service = new TitleBasedDeduplicationService();
    const existingJobs = [
      {
        id: 1,
        externalId: "greenhouse-observeai-5077208008",
        title: "Software Development Engineer III - Backend",
        url: "https://www.observe.ai/position?gh_jid=5077208008",
        location: "Bengaluru",
        status: "archived",
        description: "existing description",
      },
    ];

    const result = service.deduplicate(
      {
        externalId: "greenhouse-observeai-4173619008",
        title: "Software Development Engineer II - Backend",
        url: "https://www.observe.ai/position?gh_jid=4173619008",
        location: "Bengaluru",
      },
      existingJobs
    );

    expect(result.isNew).toBe(true);
    expect(result.matchReason).toBeUndefined();
  });
});
