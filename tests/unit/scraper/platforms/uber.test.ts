import { describe, expect, it, vi } from "vitest";

import { UberScraper } from "@/lib/scraper/platforms/uber";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

interface TestListing {
  id: number;
  title: string;
  location?: string;
  category?: string;
}

function createListingPayload(
  jobs: TestListing[],
  totalJobs: number,
  offset: number,
  limit: number
) {
  return {
    count: 1,
    hasMore: false,
    items: [
      {
        Limit: limit,
        Offset: offset,
        TotalJobsCount: totalJobs,
        requisitionList: jobs.map((job) => ({
          Id: String(job.id),
          Title: job.title,
          PrimaryLocation: job.location ?? "Bengaluru, Karnataka, India",
          PrimaryLocationCountry: "IN",
          PostedDate: "2026-08-25",
          WorkplaceType: "",
          Category: job.category ?? null,
          Department: null,
          Organization: null,
          otherWorkLocations: [],
          secondaryLocations: [],
        })),
      },
    ],
  };
}

function createDetailPayload(id: number) {
  return {
    count: 1,
    items: [
      {
        Id: String(id),
        Title: `Role ${id}`,
        PrimaryLocation: "Bengaluru, Karnataka, India",
        ExternalDescriptionStr:
          "<h2>About the role</h2><p>Build dependable systems.</p>",
        ExternalResponsibilitiesStr: "",
        ExternalQualificationsStr: "",
        ShortDescriptionStr: "",
        Category: "Engineering",
        Department: null,
        Organization: null,
        WorkplaceType: "",
      },
    ],
  };
}

function getFinder(url: string): string {
  return new URL(url).searchParams.get("finder") ?? "";
}

function getOffset(url: string): number {
  return Number(getFinder(url).match(/(?:^|,)offset=(\d+)/)?.[1] ?? 0);
}

function getDetailId(url: string): number {
  return Number(getFinder(url).match(/Id="(\d+)"/)?.[1]);
}

describe("UberScraper", () => {
  it("paginates the official Oracle careers API and hydrates details", async () => {
    const listings = [
      { id: 1, title: "Role 1" },
      { id: 2, title: "Role 2" },
      { id: 3, title: "Role 3" },
    ];
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("recruitingCEJobRequisitionDetails")) {
        return Response.json(createDetailPayload(getDetailId(url)));
      }
      const offset = getOffset(url);
      return Response.json(
        createListingPayload(listings.slice(offset, offset + 2), 3, offset, 2)
      );
    });
    const scraper = new UberScraper(createHttpClientStub({ fetch: fetchMock }), {
      listingPageSize: 2,
      detailDelayMs: 0,
    });

    const result = await scraper.scrape(
      "https://www.uber.com/in/en/careers/list/"
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 3,
      listingCompleteness: "complete",
      openExternalIds: ["uber-1", "uber-2", "uber-3"],
    });
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]).toMatchObject({
      externalId: "uber-1",
      title: "Role 1",
      location: "Bengaluru, Karnataka, India",
      department: "Engineering",
      descriptionFormat: "markdown",
      url: "https://jobs.uber.com/en/jobs/1/",
    });
    expect(result.jobs[0]?.postedDate?.toISOString()).toBe(
      "2026-08-25T00:00:00.000Z"
    );

    const listingCalls = fetchMock.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.pathname.endsWith("recruitingCEJobRequisitions"));
    expect(listingCalls).toHaveLength(2);
    expect(listingCalls.map((url) => getOffset(url.toString())).sort()).toEqual([
      0, 2,
    ]);
    expect(
      listingCalls.every(
        (url) =>
          url.hostname === "iaziqy.fa.ocs.oraclecloud.com" &&
          getFinder(url.toString()).includes("siteNumber=CX_1") &&
          getFinder(url.toString()).includes("limit=2")
      )
    ).toBe(true);
  });

  it("hydrates only new jobs while retaining every authoritative open ID", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("recruitingCEJobRequisitionDetails")) {
        return Response.json(createDetailPayload(getDetailId(url)));
      }
      return Response.json(
        createListingPayload(
          [
            { id: 1, title: "Existing" },
            { id: 2, title: "New" },
          ],
          2,
          0,
          200
        )
      );
    });
    const scraper = new UberScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });

    const result = await scraper.scrape("https://jobs.uber.com/en/jobs/", {
      existingExternalIds: new Set(["uber-1"]),
    });

    expect(result.openExternalIds).toEqual(["uber-1", "uber-2"]);
    expect(result.jobs.map((job) => job.externalId)).toEqual(["uber-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains successful pages and reports the exact failed offset", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const offset = getOffset(url);
      if (offset === 2) return new Response("unavailable", { status: 503 });
      return Response.json(
        createListingPayload(
          [
            { id: 1, title: "Role 1" },
            { id: 2, title: "Role 2" },
          ],
          3,
          0,
          2
        )
      );
    });
    const scraper = new UberScraper(createHttpClientStub({ fetch: fetchMock }), {
      listingPageSize: 2,
    });

    const result = await scraper.scrape("https://jobs.uber.com/en/jobs/", {
      existingExternalIds: new Set(["uber-1", "uber-2"]),
    });

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 2,
      listingCompleteness: "partial",
      openExternalIds: ["uber-1", "uber-2"],
    });
    if (result.outcome !== "partial") throw new Error("Expected a partial result");
    expect(result.issues?.[0]?.message).toContain("2 (HTTP 503)");
    expect(result.issues?.[0]?.message).toContain("received 2 of 3");
  });

  it("returns a parse error for an unrecognized API payload", async () => {
    const scraper = new UberScraper(
      createHttpClientStub({
        fetch: vi.fn(async () => Response.json({ jobs: [] })),
      })
    );

    const result = await scraper.scrape("https://jobs.uber.com/en/jobs/");

    expect(result).toMatchObject({
      outcome: "error",
      error: { code: "parse_error", retryable: false },
    });
  });

  it("retains listing data and reports partial when a detail call is blocked", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("recruitingCEJobRequisitionDetails")) {
        return new Response("blocked", { status: 403 });
      }
      return Response.json(
        createListingPayload(
          [{ id: 1, title: "Engineer", category: "Engineering" }],
          1,
          0,
          200
        )
      );
    });
    const scraper = new UberScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });

    const result = await scraper.scrape("https://jobs.uber.com/en/jobs/");

    expect(result).toMatchObject({
      outcome: "partial",
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      externalId: "uber-1",
      department: "Engineering",
    });
    if (result.outcome !== "partial") throw new Error("Expected a partial result");
    expect(result.issues?.[0]?.message).toContain("listing data was retained");
  });
});
