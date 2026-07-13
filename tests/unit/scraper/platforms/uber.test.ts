import { describe, expect, it, vi } from "vitest";

import { UberScraper } from "@/lib/scraper/platforms/uber";
import { createUberResponse } from "@test/fixtures/platforms/uber";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

vi.mock("@/lib/scraper/services", () => ({
  hasEarlyFilters: vi.fn(() => false),
  applyEarlyFilters: vi.fn((items: unknown[]) => ({
    filtered: items,
    filteredOut: 0,
    breakdown: { country: 0, city: 0, title: 0 },
  })),
  toEarlyFilterStats: vi.fn(() => undefined),
}));

describe("UberScraper", () => {
  it("uses canonical params payload and collects open external IDs across pages", async () => {
    const pageOneIds = Array.from({ length: 100 }, (_, index) => index + 1);
    const pageTwoIds = [101];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createUberResponse(pageOneIds, 101))
      .mockResolvedValueOnce(createUberResponse(pageTwoIds, 101));

    const httpClient = createHttpClientStub({ fetch: fetchMock });

    const scraper = new UberScraper(httpClient);
    const result = await scraper.scrape("https://www.uber.com/in/en/careers/list/");

    expect(result.outcome).not.toBe("error");
    expect(result.outcome).toBe("success");
    expect(result.listingCompleteness).toBe("complete");
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

  it("reports a partial listing when the API stops before its advertised total", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createUberResponse([1], 2));
    const httpClient = createHttpClientStub({ fetch: fetchMock });

    const result = await new UberScraper(httpClient).scrape(
      "https://www.uber.com/in/en/careers/list/"
    );

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 2,
      listingCompleteness: "partial",
      openExternalIds: ["uber-1"],
    });
  });

  it("accepts jobs with nullable production location fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createUberResponse([1], 1, { nullableLocation: true })
      );
    const result = await new UberScraper(
      createHttpClientStub({ fetch: fetchMock })
    ).scrape("https://www.uber.com/in/en/careers/list/");

    expect(result).toMatchObject({ outcome: "success", totalListings: 1 });
    expect(result.jobs[0]?.location).toBeUndefined();
  });

  it("accepts the current totalResults long object returned by Uber", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createUberResponse([1], 1, { totalShape: "long" })
      );

    const result = await new UberScraper(
      createHttpClientStub({ fetch: fetchMock })
    ).scrape("https://www.uber.com/in/en/careers/list/");

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
      openExternalIds: ["uber-1"],
    });
  });

  it("infers completeness from a short final page when no total is advertised", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createUberResponse([1], 1, { totalShape: "omitted" })
      );

    const result = await new UberScraper(
      createHttpClientStub({ fetch: fetchMock })
    ).scrape("https://www.uber.com/in/en/careers/list/");

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
    });
  });
});
