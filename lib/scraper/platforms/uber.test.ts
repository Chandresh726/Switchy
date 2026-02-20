import { describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { UberScraper } from "@/lib/scraper/platforms/uber";

vi.mock("@/lib/scraper/services", () => ({
  hasEarlyFilters: vi.fn(() => false),
  applyEarlyFilters: vi.fn((items: unknown[]) => ({
    filtered: items,
    filteredOut: 0,
    breakdown: { country: 0, city: 0, title: 0 },
  })),
  toEarlyFilterStats: vi.fn(() => undefined),
}));

interface UberJobFixture {
  id: number;
}

function createUberJob({ id }: UberJobFixture) {
  return {
    id,
    title: `Role ${id}`,
    description: `Description ${id}`,
    department: "Engineering",
    type: "job",
    programAndPlatform: null,
    location: {
      country: "IN",
      region: "KA",
      city: "Bangalore",
      countryName: "India",
    },
    featured: false,
    level: "Senior",
    creationDate: "2026-01-01T00:00:00.000Z",
    otherLevels: null,
    team: "Platform",
    portalID: 1,
    isPipeline: false,
    statusID: 1,
    statusName: "Open",
    updatedDate: "2026-01-01T00:00:00.000Z",
    uniqueSkills: null,
    timeType: "full-time",
    allLocations: null,
  };
}

function createUberResponse(jobIds: number[]): Response {
  return new Response(
    JSON.stringify({
      status: "success",
      data: {
        total: jobIds.length,
        results: jobIds.map((id) => createUberJob({ id })),
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("UberScraper", () => {
  it("uses canonical params payload and collects open external IDs across pages", async () => {
    const pageOneIds = Array.from({ length: 100 }, (_, index) => index + 1);
    const pageTwoIds = [101];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createUberResponse(pageOneIds))
      .mockResolvedValueOnce(createUberResponse(pageTwoIds));

    const httpClient: IHttpClient = {
      fetch: fetchMock,
      get: vi.fn(),
      post: vi.fn(),
    };

    const scraper = new UberScraper(httpClient);
    const result = await scraper.scrape("https://www.uber.com/in/en/careers/list/");

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(result.openExternalIdsComplete).toBe(true);
    expect(result.openExternalIds).toHaveLength(101);
    expect(result.openExternalIds).toContain("uber-1");
    expect(result.openExternalIds).toContain("uber-101");

    const firstRequestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const secondRequestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));

    expect(firstRequestBody).toEqual({
      page: 0,
      limit: 100,
      params: {
        department: [],
        lineOfBusinessName: [],
        location: [],
        programAndPlatform: [],
        team: [],
      },
    });
    expect(firstRequestBody).not.toHaveProperty("filter");
    expect(secondRequestBody.page).toBe(1);
  });
});
