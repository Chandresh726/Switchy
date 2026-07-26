import { describe, expect, it, vi } from "vitest";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import { BrowserSessionBootstrapError } from "@/lib/scraper/infrastructure/browser-session-error";
import type { HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import { EightfoldScraper } from "@/lib/scraper/platforms/eightfold";
import {
  createEightfoldDetailResponse,
  createEightfoldSearchResponse,
} from "@test/fixtures/platforms/eightfold";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

function createMockBrowserClient(
  bootstrapResult: Awaited<ReturnType<IBrowserClient["bootstrap"]>>
): IBrowserClient {
  return {
    bootstrap: vi.fn(async () => bootstrapResult),
    withBrowser: vi.fn(async () => {
      throw new Error("not used in this test");
    }),
    close: vi.fn(async () => undefined),
  };
}

type FetchMock = ReturnType<typeof vi.fn<(url: string, options?: HttpRequestOptions) => Promise<Response>>>;
type FetchCall = [url: string, options?: HttpRequestOptions];

function getFetchCalls(fetchMock: FetchMock): FetchCall[] {
  return fetchMock.mock.calls as FetchCall[];
}

describe("EightfoldScraper", () => {
  it("uses bootstrapped cookies and returns partial when detail endpoints are blocked", async () => {
    const positionIds = [1, 2, 3, 4];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        return createEightfoldSearchResponse(positionIds);
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      if (requestedId === 3) {
        return new Response("forbidden", { status: 403 });
      }
      if (requestedId === 4) {
        return new Response("rate_limited", { status: 429 });
      }

      return createEightfoldDetailResponse(requestedId);
    });
    const httpClient = createHttpClientStub({ fetch: fetchMock });
    const browserClient = createMockBrowserClient({
      baseUrl: "https://apply.careers.microsoft.com",
      cookies: "session=abc",
      domain: "microsoft.com",
    });
    const scraper = new EightfoldScraper(httpClient, browserClient, {
      detailBatchSize: 4,
      requestDelayMs: 0,
    });

    const result = await scraper.scrape("https://apply.careers.microsoft.com/careers");

    expect(result.outcome).not.toBe("error");
    expect(result.outcome).toBe("partial");
    expect(result.jobs).toHaveLength(4);

    const describedJobs = result.jobs.filter((job) => typeof job.description === "string");
    const missingDescriptionJobs = result.jobs.filter((job) => !job.description);
    expect(describedJobs).toHaveLength(2);
    expect(missingDescriptionJobs).toHaveLength(2);

    const searchCall = getFetchCalls(fetchMock).find(([url]) => String(url).includes("/api/pcsx/search"));
    expect(searchCall?.[1]?.headers).toMatchObject({
      Cookie: "session=abc",
    });

    const detailCalls = getFetchCalls(fetchMock).filter(([url]) =>
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
        return createEightfoldSearchResponse(positionIds);
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      if (requestedId === 2) {
        return new Response("forbidden", { status: 403 });
      }
      if (requestedId === 3) {
        return new Response("rate_limited", { status: 429 });
      }

      return createEightfoldDetailResponse(requestedId, `Detailed description ${requestedId}`);
    });
    const httpClient = createHttpClientStub({ fetch: fetchMock });
    const browserClient = createMockBrowserClient({
      baseUrl: "https://apply.careers.microsoft.com",
      cookies: "session=abc",
      domain: "microsoft.com",
    });
    const scraper = new EightfoldScraper(httpClient, browserClient, {
      detailBatchSize: 4,
      requestDelayMs: 0,
    });

    const result = await scraper.scrape("https://apply.careers.microsoft.com/careers");

    expect(result.outcome).not.toBe("error");
    expect(result.outcome).toBe("partial");
    expect(result.jobs).toHaveLength(8);
    expect(result.jobs.find((job) => job.externalId === "eightfold-microsoft-8")?.description).toContain(
      "Detailed description 8"
    );
    expect(getFetchCalls(fetchMock).filter(([url]) => url.includes("/api/pcsx/position_details")).length).toBe(8);
  });

  it("continues scraping with empty session cookies and omits Cookie header", async () => {
    const positionIds = [11];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        return createEightfoldSearchResponse(positionIds);
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      return createEightfoldDetailResponse(requestedId);
    });
    const httpClient = createHttpClientStub({ fetch: fetchMock });
    const browserClient = createMockBrowserClient({
      baseUrl: "https://apply.careers.microsoft.com",
      cookies: "",
      domain: "microsoft.com",
    });
    const scraper = new EightfoldScraper(httpClient, browserClient, {
      detailBatchSize: 1,
      requestDelayMs: 0,
    });

    const result = await scraper.scrape("https://apply.careers.microsoft.com/careers");

    expect(result.outcome).not.toBe("error");
    expect(result.outcome).toBe("success");
    expect(result.jobs).toHaveLength(1);

    const searchCall = getFetchCalls(fetchMock).find(([url]) => String(url).includes("/api/pcsx/search"));
    expect(searchCall?.[1]?.headers).not.toHaveProperty("Cookie");

    const detailCall = getFetchCalls(fetchMock).find(([url]) =>
      String(url).includes("/api/pcsx/position_details")
    );
    expect(detailCall?.[1]?.headers).not.toHaveProperty("Cookie");
  });

  it("refreshes the browser session and retries only missing list offsets", async () => {
    let secondPageAttempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        const offset = Number(new URL(url).searchParams.get("start"));
        if (offset === 0) {
          return createEightfoldSearchResponse(
            Array.from({ length: 10 }, (_, index) => index + 1),
            15
          );
        }
        if (secondPageAttempts++ === 0) {
          return new Response("expired", { status: 403 });
        }
        return createEightfoldSearchResponse([11, 12, 13, 14, 15], 15);
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      return createEightfoldDetailResponse(requestedId);
    });
    const bootstrap = vi
      .fn()
      .mockResolvedValueOnce({
        baseUrl: "https://apply.careers.microsoft.com",
        cookies: "session=old",
        domain: "microsoft.com",
      })
      .mockResolvedValueOnce({
        baseUrl: "https://apply.careers.microsoft.com",
        cookies: "session=fresh",
        domain: "microsoft.com",
      });
    const browserClient: IBrowserClient = {
      bootstrap,
      withBrowser: vi.fn(async () => {
        throw new Error("not used");
      }),
      close: vi.fn(async () => undefined),
    };
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      browserClient,
      { requestDelayMs: 0 }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers"
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 15,
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(15);
    expect(bootstrap).toHaveBeenCalledTimes(2);
    const secondPageCalls = getFetchCalls(fetchMock).filter(([url]) =>
      url.includes("start=10")
    );
    expect(secondPageCalls).toHaveLength(2);
    expect(secondPageCalls[1]?.[1]?.headers).toMatchObject({
      Cookie: "session=fresh",
    });
    const detailCall = getFetchCalls(fetchMock).find(([url]) =>
      url.includes("position_details")
    );
    expect(detailCall?.[1]?.headers).toMatchObject({
      Cookie: "session=fresh",
    });
  });

  it("preserves typed browser errors when the recovery session cannot start", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("start=0")) {
        return createEightfoldSearchResponse(
          Array.from({ length: 10 }, (_, index) => index + 1),
          15
        );
      }
      return new Response("expired", { status: 403 });
    });
    const bootstrap = vi
      .fn()
      .mockResolvedValueOnce({
        baseUrl: "https://apply.careers.microsoft.com",
        cookies: "session=old",
        domain: "microsoft.com",
      })
      .mockRejectedValueOnce(new BrowserSessionBootstrapError("navigation"));
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      {
        bootstrap,
        withBrowser: vi.fn(async () => {
          throw new Error("not used");
        }),
        close: vi.fn(async () => undefined),
      },
      { requestDelayMs: 0 }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers"
    );

    expect(result).toMatchObject({
      outcome: "error",
      error: {
        code: "browser_error",
        message: "Failed to establish browser session during navigation.",
      },
    });
  });

  it("reports fetched and advertised counts when an offset remains missing", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        const offset = Number(new URL(url).searchParams.get("start"));
        return offset === 0
          ? createEightfoldSearchResponse(
              Array.from({ length: 10 }, (_, index) => index + 1),
              15
            )
          : new Response("blocked", { status: 403 });
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      return createEightfoldDetailResponse(requestedId);
    });
    const bootstrap = vi.fn(async () => ({
      baseUrl: "https://apply.careers.microsoft.com",
      cookies: "session=abc",
      domain: "microsoft.com",
    }));
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      {
        bootstrap,
        withBrowser: vi.fn(async () => {
          throw new Error("not used");
        }),
        close: vi.fn(async () => undefined),
      },
      { requestDelayMs: 0 }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers"
    );

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 10,
      listingCompleteness: "partial",
      issues: [
        expect.objectContaining({
          message: expect.stringContaining("10 of 15 advertised positions"),
        }),
      ],
    });
    expect(result.openExternalIds).toHaveLength(10);
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });

  it("recovers overlapping full pages from the complete sitemap", async () => {
    const pageAttempts = new Map<number, number>();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        const offset = Number(new URL(url).searchParams.get("start"));
        pageAttempts.set(offset, (pageAttempts.get(offset) ?? 0) + 1);

        if (offset === 0) {
          return createEightfoldSearchResponse([1, 2, 3], 6);
        }
        return createEightfoldSearchResponse(
          [3, 4, 5],
          6
        );
      }
      if (url.includes("/careers/sitemap.xml")) {
        return new Response(
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from(
            { length: 6 },
            (_, index) =>
              `<url><loc>https://apply.careers.microsoft.com/careers/job/${index + 1}</loc></url>`
          ).join("")}</urlset>`,
          {
            status: 200,
            headers: { "Content-Type": "application/xml" },
          }
        );
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      return createEightfoldDetailResponse(requestedId);
    });
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      createMockBrowserClient({
        baseUrl: "https://apply.careers.microsoft.com",
        cookies: "session=abc",
        domain: "microsoft.com",
      }),
      {
        pageSize: 3,
        parallelListFetches: 1,
        detailBatchSize: 6,
        requestDelayMs: 0,
      }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers"
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 6,
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(6);
    expect(pageAttempts).toEqual(new Map([[0, 1], [3, 1]]));
  });

  it("remains partial when overlapping pages have no sitemap fallback", async () => {
    const pageAttempts = new Map<number, number>();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        const offset = Number(new URL(url).searchParams.get("start"));
        pageAttempts.set(offset, (pageAttempts.get(offset) ?? 0) + 1);
        return createEightfoldSearchResponse(
          offset === 0 ? [1, 2, 3] : [3, 4, 5],
          6
        );
      }
      if (url.includes("/careers/sitemap.xml")) {
        return new Response("unavailable", { status: 404 });
      }

      const requestedId = Number(new URL(url).searchParams.get("position_id"));
      return createEightfoldDetailResponse(requestedId);
    });
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      createMockBrowserClient({
        baseUrl: "https://apply.careers.microsoft.com",
        cookies: "session=abc",
        domain: "microsoft.com",
      }),
      {
        pageSize: 3,
        parallelListFetches: 1,
        detailBatchSize: 5,
        requestDelayMs: 0,
      }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers"
    );

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 5,
      listingCompleteness: "partial",
      issues: [
        expect.objectContaining({
          message: expect.stringContaining("5 of 6 advertised positions"),
        }),
      ],
    });
    expect(pageAttempts).toEqual(new Map([[0, 1], [3, 1]]));
  });

});
