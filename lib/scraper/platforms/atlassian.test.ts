import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { AtlassianScraper } from "@/lib/scraper/platforms/atlassian";

const earlyFilterMocks = vi.hoisted(() => ({
  hasEarlyFilters: vi.fn(),
  applyEarlyFilters: vi.fn(),
  toEarlyFilterStats: vi.fn(),
}));

vi.mock("@/lib/scraper/services", () => ({
  hasEarlyFilters: earlyFilterMocks.hasEarlyFilters,
  applyEarlyFilters: earlyFilterMocks.applyEarlyFilters,
  toEarlyFilterStats: earlyFilterMocks.toEarlyFilterStats,
}));

function createHttpClient(fetchMock: ReturnType<typeof vi.fn>): IHttpClient {
  return {
    fetch: fetchMock,
    get: vi.fn(),
    post: vi.fn(),
  };
}

describe("AtlassianScraper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    earlyFilterMocks.hasEarlyFilters.mockReturnValue(false);
    earlyFilterMocks.applyEarlyFilters.mockImplementation((items: unknown[]) => ({
      filtered: items,
      filteredOut: 0,
      breakdown: { country: 0, city: 0, title: 0 },
    }));
    earlyFilterMocks.toEarlyFilterStats.mockReturnValue(undefined);
  });

  it("filters by source URL query and uses listing description fields without details call", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/endpoint/careers/listings")) {
        return new Response(
          JSON.stringify([
            {
              id: 101,
              title: "Software Engineer",
              category: "Engineering",
              locations: ["Bengaluru, India"],
              overview: "<p>Build cloud products.</p>",
              responsibilities: "<ul><li>Ship features</li></ul>",
            },
            {
              id: 102,
              title: "Account Executive",
              category: "Sales",
              locations: ["Sydney, Australia"],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("not found", { status: 404 });
    });

    const scraper = new AtlassianScraper(createHttpClient(fetchMock), {
      detailDelayMs: 0,
    });
    const result = await scraper.scrape(
      "https://www.atlassian.com/company/careers/all-jobs?team=Engineering&location=India&search=Software"
    );

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.externalId).toBe("atlassian-101");
    expect(result.jobs[0]?.url).toBe("https://www.atlassian.com/company/careers/details/101");
    expect(result.jobs[0]?.description).toBeDefined();
    expect(result.openExternalIds).toEqual(["atlassian-101"]);

    const detailCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/endpoint/careers/details/")
    );
    expect(detailCalls).toHaveLength(0);
  });

  it("returns partial when details fetch fails for listings missing text fields", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/endpoint/careers/listings")) {
        return new Response(
          JSON.stringify([
            {
              id: 201,
              title: "Backend Engineer",
              category: "Engineering",
              locations: ["Bengaluru, India"],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("/endpoint/careers/details/201")) {
        return new Response("blocked", { status: 429 });
      }

      return new Response("not found", { status: 404 });
    });

    const scraper = new AtlassianScraper(createHttpClient(fetchMock), {
      detailDelayMs: 0,
    });
    const result = await scraper.scrape("https://www.atlassian.com/company/careers/all-jobs");

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("partial");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.externalId).toBe("atlassian-201");
    expect(result.jobs[0]?.description).toBeUndefined();
    expect(result.openExternalIds).toEqual(["atlassian-201"]);
    expect(result.openExternalIdsComplete).toBe(true);
  });
});
