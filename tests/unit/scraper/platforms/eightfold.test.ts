import { describe, expect, it, vi } from "vitest";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import { EightfoldScraper } from "@/lib/scraper/platforms/eightfold";
import {
  createEightfoldDetailResponse,
  createEightfoldSearchResponse,
} from "@test/fixtures/platforms/eightfold";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

type FetchMock = ReturnType<
  typeof vi.fn<(url: string, options?: HttpRequestOptions) => Promise<Response>>
>;

function browserClient(bootstrap = vi.fn(async () => ({
  baseUrl: "https://apply.careers.microsoft.com",
  cookies: "session=fresh",
  domain: "microsoft.com",
}))): IBrowserClient {
  return {
    bootstrap,
    withBrowser: vi.fn(async () => {
      throw new Error("not used");
    }),
    close: vi.fn(async () => undefined),
  };
}

describe("EightfoldScraper", () => {
  it("uses direct HTTP and preserves configured source filters", async () => {
    const bootstrap = vi.fn(async () => {
      throw new Error("browser must remain unused");
    });
    const fetchMock: FetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        return createEightfoldSearchResponse([1]);
      }
      return createEightfoldDetailResponse(1);
    });
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      browserClient(bootstrap)
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers?domain=microsoft.com&query=software&location=India&sort_by=relevance&filter_include_remote=true&Codes=A&Codes=B&pid=ignored"
    );

    expect(result).toMatchObject({
      outcome: "success",
      detectedBoardToken: "microsoft.com",
      listingCompleteness: "complete",
    });
    expect(bootstrap).not.toHaveBeenCalled();
    const searchCall = fetchMock.mock.calls.find(([url]) =>
      url.includes("/api/pcsx/search")
    );
    const searchUrl = new URL(searchCall?.[0] ?? "");
    expect(searchUrl.searchParams.get("query")).toBe("software");
    expect(searchUrl.searchParams.get("location")).toBe("India");
    expect(searchUrl.searchParams.get("sort_by")).toBe("relevance");
    expect(searchUrl.searchParams.get("filter_include_remote")).toBe("true");
    expect(searchUrl.searchParams.getAll("Codes")).toEqual(["A", "B"]);
    expect(searchUrl.searchParams.has("pid")).toBe(false);
    expect(searchCall?.[1]?.headers).not.toHaveProperty("Cookie");
    const detailCall = fetchMock.mock.calls.find(([url]) =>
      url.includes("position_details")
    );
    expect(detailCall?.[1]?.headers).not.toHaveProperty("Cookie");
  });

  it("prefers a valid board token over the source domain parameter", async () => {
    const fetchMock: FetchMock = vi.fn(async (url: string) =>
      url.includes("/api/pcsx/search")
        ? createEightfoldSearchResponse([])
        : createEightfoldDetailResponse(1)
    );
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      browserClient()
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers?domain=microsoft.com",
      { boardToken: "paypal.com" }
    );

    expect(result.outcome).toBe("success");
    const searchUrl = new URL(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(searchUrl.searchParams.get("domain")).toBe("paypal.com");
  });

  it("bootstraps once on 403 and retries with browser cookies", async () => {
    const bootstrap = vi.fn(async () => ({
      baseUrl: "https://apply.careers.microsoft.com",
      cookies: "session=fresh",
      domain: "microsoft.com",
    }));
    const fetchMock: FetchMock = vi.fn(async (
      url: string,
      options?: HttpRequestOptions
    ) => {
      const headers = options?.headers as Record<string, string> | undefined;
      if (!headers?.Cookie) return new Response("forbidden", { status: 403 });
      return url.includes("/api/pcsx/search")
        ? createEightfoldSearchResponse([1])
        : createEightfoldDetailResponse(1);
    });
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      browserClient(bootstrap),
      { baseDelay: 0, retries: 1 }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers?domain=microsoft.com"
    );

    expect(result.outcome).toBe("success");
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Cookie");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).not.toHaveProperty("Cookie");
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      Cookie: "session=fresh",
    });
  });

  it("retains listing fallbacks when detail-session bootstrap fails", async () => {
    const bootstrap = vi.fn(async () => ({
      baseUrl: "https://apply.careers.microsoft.com",
      cookies: "",
      domain: "microsoft.com",
    }));
    const fetchMock: FetchMock = vi.fn(async (url: string) =>
      url.includes("/api/pcsx/search")
        ? createEightfoldSearchResponse([1])
        : new Response("forbidden", { status: 403 })
    );
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      browserClient(bootstrap),
      { baseDelay: 0, retries: 0, detailRecoveryAttempts: 0 }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers?domain=microsoft.com"
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
    });
    // A single failed detail degrades to a warning instead of failing the board.
    const detailWarning = "issues" in result ? result.issues?.[0]?.message : undefined;
    expect(detailWarning).toContain("detail request");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      externalId: "eightfold-microsoft-1",
      title: "Role 1",
    });
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it("retries one transient cookie-free 403 without starting a browser", async () => {
    let searchAttempts = 0;
    const bootstrap = vi.fn(async () => {
      throw new Error("browser must remain unused");
    });
    const fetchMock: FetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        searchAttempts++;
        return searchAttempts === 1
          ? new Response("throttled", { status: 403 })
          : createEightfoldSearchResponse([1]);
      }
      return createEightfoldDetailResponse(1);
    });
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      browserClient(bootstrap),
      { baseDelay: 0, retries: 1 }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers?domain=microsoft.com"
    );

    expect(result.outcome).toBe("success");
    expect(searchAttempts).toBe(2);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("fetches no more than six listing pages concurrently", async () => {
    const total = 70;
    let active = 0;
    let maxActive = 0;
    const fetchMock: FetchMock = vi.fn(async (url: string) => {
      if (!url.includes("/api/pcsx/search")) {
        return createEightfoldDetailResponse(1);
      }
      const start = Number(new URL(url).searchParams.get("start"));
      if (start > 0) {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
      }
      return createEightfoldSearchResponse(
        Array.from({ length: 10 }, (_, index) => start + index + 1),
        total
      );
    });
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      browserClient(),
      { parallelListFetches: 6 }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers?domain=microsoft.com",
      { filters: { titleKeywords: ["does-not-match"] } }
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 70,
      listingCompleteness: "complete",
    });
    expect(maxActive).toBe(6);
  });

  it("uses sitemap IDs only after overlapping pages and requires hydration", async () => {
    const sitemap = `<urlset>${Array.from(
      { length: 12 },
      (_, index) =>
        `<url><loc>https://apply.careers.microsoft.com/careers/job/${index + 1}</loc></url>`
    ).join("")}</urlset>`;
    const fetchMock: FetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/pcsx/search")) {
        const start = Number(new URL(url).searchParams.get("start"));
        return start === 0
          ? createEightfoldSearchResponse(
              Array.from({ length: 10 }, (_, index) => index + 1),
              12
            )
          : createEightfoldSearchResponse([9, 10], 12);
      }
      if (url.includes("/careers/sitemap.xml")) {
        return new Response(sitemap, { status: 200 });
      }
      const id = Number(new URL(url).searchParams.get("position_id"));
      return createEightfoldDetailResponse(id);
    });
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      browserClient(),
      { requestDelayMs: 0 }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers?domain=microsoft.com"
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 12,
      listingCompleteness: "complete",
    });
    expect(result.openExternalIds).toHaveLength(12);
    for (const id of [11, 12]) {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          url.includes(`position_id=${id}`)
        )
      ).toBe(true);
    }
  });

  it("does not broaden a filtered source with tenant-wide sitemap IDs", async () => {
    const fetchMock: FetchMock = vi.fn(async (url: string) => {
      if (url.includes("/careers/sitemap.xml")) {
        throw new Error("filtered searches must not use the global sitemap");
      }
      if (url.includes("/api/pcsx/search")) {
        const start = Number(new URL(url).searchParams.get("start"));
        return start === 0
          ? createEightfoldSearchResponse(
              Array.from({ length: 10 }, (_, index) => index + 1),
              12
            )
          : createEightfoldSearchResponse([9, 10], 12);
      }
      const id = Number(new URL(url).searchParams.get("position_id"));
      return createEightfoldDetailResponse(id);
    });
    const scraper = new EightfoldScraper(
      createHttpClientStub({ fetch: fetchMock }),
      browserClient(),
      { requestDelayMs: 0 }
    );

    const result = await scraper.scrape(
      "https://apply.careers.microsoft.com/careers?domain=microsoft.com&query=Software+Engineer"
    );

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 10,
      listingCompleteness: "partial",
    });
    // A gap beyond the small-board tolerance stays partial, and filtered
    // searches must not trigger tenant-wide sitemap recovery.
    expect(result.openExternalIds).toHaveLength(10);
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes("/careers/sitemap.xml"))
    ).toBe(false);
  });
});
