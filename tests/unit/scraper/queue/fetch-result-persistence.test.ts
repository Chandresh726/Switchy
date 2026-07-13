import { describe, expect, it } from "vitest";

import {
  createFetchResultFromCommittedScrape,
  parseFetchResult,
  serializeFetchResult,
} from "@/lib/scraper/queue/fetch-result-persistence";

const result = {
  companyId: 7,
  companyName: "Acme",
  success: true,
  outcome: "success" as const,
  jobsFound: 8,
  jobsAdded: 3,
  jobsUpdated: 1,
  jobsFiltered: 2,
  jobsArchived: 4,
  platform: "greenhouse" as const,
  duration: 250,
  logId: 11,
};

describe("FetchResult persistence", () => {
  it("round-trips the canonical durable schema", () => {
    const serialized = serializeFetchResult(result);

    expect(parseFetchResult(serialized, result.companyId)).toEqual(result);
    expect(parseFetchResult(serialized, 99)).toBeNull();
  });

  it("rejects malformed and incomplete queue payloads", () => {
    expect(parseFetchResult("{not-json", 7)).toBeNull();
    expect(
      parseFetchResult(JSON.stringify({ companyId: 7, outcome: "success" }), 7)
    ).toBeNull();
  });

  it("projects a committed partial log without losing counters", () => {
    expect(
      createFetchResultFromCommittedScrape({
        companyId: 7,
        companyName: null,
        logId: 12,
        status: "partial",
        jobsFound: 9,
        jobsAdded: null,
        jobsUpdated: 2,
        jobsFiltered: 3,
        jobsArchived: 4,
        platform: "unknown-platform",
        duration: null,
      })
    ).toEqual({
      companyId: 7,
      companyName: "Unknown",
      success: false,
      outcome: "partial",
      jobsFound: 9,
      jobsAdded: 0,
      jobsUpdated: 2,
      jobsFiltered: 3,
      jobsArchived: 4,
      platform: null,
      duration: 0,
      logId: 12,
    });
  });
});
