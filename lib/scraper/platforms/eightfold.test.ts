import { describe, expect, it, vi } from "vitest";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { EightfoldScraper } from "@/lib/scraper/platforms/eightfold";

vi.mock("@/lib/scraper/services", () => ({
  hasEarlyFilters: vi.fn(() => false),
  applyEarlyFilters: vi.fn((items: unknown[]) => ({
    filtered: items,
    filteredOut: 0,
    breakdown: { country: 0, city: 0, title: 0 },
  })),
  toEarlyFilterStats: vi.fn(() => undefined),
}));

function createSearchResponse(positionIds: number[]): Response {
  return new Response(
    JSON.stringify({
      status: 200,
      data: {
        count: positionIds.length,
        positions: positionIds.map((id) => ({
          id,
          name: `Role ${id}`,
          locations: ["Bangalore"],
          postedTs: 1735603200,
          positionUrl: `/careers/job/${id}`,
        })),
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function createDetailResponse(positionId: number, description = `Description ${positionId}`): Response {
  return new Response(
    JSON.stringify({
      status: 200,
      data: {
        id: positionId,
        name: `Role ${positionId}`,
        locations: ["Bangalore"],
        jobDescription: description,
        publicUrl: `https://apply.careers.microsoft.com/careers/job/${positionId}`,
        workLocationOption: "onsite",
        efcustomTextTimeType: ["full-time"],
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("EightfoldScraper", () => {
  it("uses bootstrapped cookies and returns partial when detail endpoints are blocked", async () => {
    const positionIds = [1, 2, 3, 4];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        return createSearchResponse(positionIds);
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      if (requestedId === 3) {
        return new Response("forbidden", { status: 403 });
      }
      if (requestedId === 4) {
        return new Response("rate_limited", { status: 429 });
      }

      return createDetailResponse(requestedId);
    });
    const httpClient: IHttpClient = {
      fetch: fetchMock,
      get: vi.fn(),
      post: vi.fn(),
    };
    const browserClient: IBrowserClient = {
      bootstrap: vi.fn(async () => ({
        baseUrl: "https://apply.careers.microsoft.com",
        cookies: "session=abc",
        domain: "microsoft.com",
      })),
      close: vi.fn(async () => undefined),
    };
    const scraper = new EightfoldScraper(httpClient, browserClient, {
      detailBatchSize: 4,
      requestDelayMs: 0,
    });

    const result = await scraper.scrape("https://apply.careers.microsoft.com/careers");

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("partial");
    expect(result.jobs).toHaveLength(4);

    const describedJobs = result.jobs.filter((job) => typeof job.description === "string");
    const missingDescriptionJobs = result.jobs.filter((job) => !job.description);
    expect(describedJobs).toHaveLength(2);
    expect(missingDescriptionJobs).toHaveLength(2);

    const searchCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/pcsx/search"));
    expect(searchCall?.[1]?.headers).toMatchObject({
      Cookie: "session=abc",
    });

    const detailCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/pcsx/position_details")
    );
    expect(detailCalls.length).toBe(4);
    for (const [, options] of detailCalls) {
      expect(options?.headers).toMatchObject({
        Cookie: "session=abc",
      });
    }
  });

  it("continues processing later details after early 403/429 responses", async () => {
    const positionIds = [1, 2, 3, 4, 5, 6, 7, 8];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        return createSearchResponse(positionIds);
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      if (requestedId === 2) {
        return new Response("forbidden", { status: 403 });
      }
      if (requestedId === 3) {
        return new Response("rate_limited", { status: 429 });
      }

      return createDetailResponse(requestedId, `Detailed description ${requestedId}`);
    });
    const httpClient: IHttpClient = {
      fetch: fetchMock,
      get: vi.fn(),
      post: vi.fn(),
    };
    const browserClient: IBrowserClient = {
      bootstrap: vi.fn(async () => ({
        baseUrl: "https://apply.careers.microsoft.com",
        cookies: "session=abc",
        domain: "microsoft.com",
      })),
      close: vi.fn(async () => undefined),
    };
    const scraper = new EightfoldScraper(httpClient, browserClient, {
      detailBatchSize: 4,
      requestDelayMs: 0,
    });

    const result = await scraper.scrape("https://apply.careers.microsoft.com/careers");

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("partial");
    expect(result.jobs).toHaveLength(8);
    expect(result.jobs.find((job) => job.externalId === "eightfold-microsoft-8")?.description).toContain(
      "Detailed description 8"
    );
    expect(fetchMock.mock.calls.filter(([url]) => url.includes("/api/pcsx/position_details")).length).toBe(8);
  });

  it("continues scraping with empty session cookies and omits Cookie header", async () => {
    const positionIds = [11];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        return createSearchResponse(positionIds);
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      return createDetailResponse(requestedId);
    });
    const httpClient: IHttpClient = {
      fetch: fetchMock,
      get: vi.fn(),
      post: vi.fn(),
    };
    const browserClient: IBrowserClient = {
      bootstrap: vi.fn(async () => ({
        baseUrl: "https://apply.careers.microsoft.com",
        cookies: "",
        domain: "microsoft.com",
      })),
      close: vi.fn(async () => undefined),
    };
    const scraper = new EightfoldScraper(httpClient, browserClient, {
      detailBatchSize: 1,
      requestDelayMs: 0,
    });

    const result = await scraper.scrape("https://apply.careers.microsoft.com/careers");

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(result.jobs).toHaveLength(1);

    const searchCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/pcsx/search"));
    expect(searchCall?.[1]?.headers).not.toHaveProperty("Cookie");

    const detailCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/api/pcsx/position_details")
    );
    expect(detailCall?.[1]?.headers).not.toHaveProperty("Cookie");
  });

});
