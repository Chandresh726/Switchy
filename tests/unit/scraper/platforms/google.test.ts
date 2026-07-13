import { beforeEach, describe, expect, it, vi } from "vitest";

import { GoogleScraper } from "@/lib/scraper/platforms/google";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

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

describe("GoogleScraper", () => {
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

  it("collects openExternalIds from all list pages while early filtering reduces detail fetches", async () => {
    earlyFilterMocks.hasEarlyFilters.mockReturnValue(true);
    earlyFilterMocks.applyEarlyFilters.mockImplementation((items: unknown[]) => ({
      filtered: items.slice(0, 1),
      filteredOut: 2,
      breakdown: { country: 0, city: 0, title: 2 },
    }));
    earlyFilterMocks.toEarlyFilterStats.mockReturnValue({
      total: 3,
      country: 0,
      city: 0,
      title: 2,
    });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/jobs/results") && !url.includes("/jobs/results/")) {
        const page = new URL(url).searchParams.get("page");
        if (page === "2") {
          return new Response(
            `
              <html><body>
                <a href="/about/careers/applications/jobs/results/3-role-three">Role Three</a>
              </body></html>
            `,
            { status: 200, headers: { "Content-Type": "text/html" } }
          );
        }

        return new Response(
          `
            <html><body>
              <a href="jobs/results/1-role-one">Role One</a>
              <a href="jobs/results/2-role-two">Role Two</a>
              <a href="/about/careers/applications/jobs/results?page=2">Next</a>
            </body></html>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (url.includes("/jobs/results/1-role-one")) {
        return new Response(
          `
            <main>
              <h2>Role One</h2>
              <h3>About the job</h3>
              <p>Build products.</p>
              <h3>Minimum qualifications</h3>
              <p>CS degree.</p>
            </main>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      return new Response("not found", { status: 404 });
    });

    const scraper = new GoogleScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });
    const result = await scraper.scrape(
      "https://www.google.com/about/careers/applications/jobs/results?location=India",
      { filters: { titleKeywords: ["role"] } }
    );

    expect(result.outcome).not.toBe("error");
    expect(result.outcome).toBe("success");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.externalId).toBe("google-1");
    expect(result.openExternalIds).toEqual(["google-1", "google-2", "google-3"]);
    expect(result.listingCompleteness).toBe("complete");

    const detailCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/jobs/results/1-role-one")
    );
    expect(detailCalls).toHaveLength(1);
  });

  it("returns partial when detail fetch fails but list succeeds", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/jobs/results") && !url.includes("/jobs/results/")) {
        return new Response(
          `
            <html><body>
              <a href="/about/careers/applications/jobs/results/10-role-ten">Role Ten</a>
            </body></html>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      return new Response("blocked", { status: 429 });
    });

    const scraper = new GoogleScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });
    const result = await scraper.scrape(
      "https://www.google.com/about/careers/applications/jobs/results?location=India"
    );

    expect(result.outcome).not.toBe("error");
    expect(result.outcome).toBe("partial");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.externalId).toBe("google-10");
    expect(result.jobs[0]?.description).toBeUndefined();
    expect(result.openExternalIds).toEqual(["google-10"]);
    expect(result.listingCompleteness).toBe("complete");
  });

  it("normalizes generic Google careers URLs to the jobs listing endpoint", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/jobs/results") && !url.includes("/jobs/results/")) {
        return new Response(
          `
            <html><body>
              <a href="/about/careers/applications/jobs/results/20-role-twenty">Role Twenty</a>
            </body></html>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      if (url.includes("/jobs/results/20-role-twenty")) {
        return new Response(
          `
            <main>
              <h2>Role Twenty</h2>
              <h3>About the job</h3>
              <p>Build systems.</p>
            </main>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }

      return new Response("not found", { status: 404 });
    });

    const scraper = new GoogleScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });
    const result = await scraper.scrape("https://www.google.com/about/careers");

    expect(result.outcome).not.toBe("error");
    expect(result.jobs[0]?.externalId).toBe("google-20");
  });

  it("rejects a 200 challenge page instead of treating it as an empty board", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("<html><body>Verify you are human</body></html>", { status: 200 })
    );
    const scraper = new GoogleScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape(
      "https://www.google.com/about/careers/applications/jobs/results"
    );

    expect(result).toMatchObject({
      outcome: "error",
      listingCompleteness: "unknown",
      error: { code: "parse_error" },
    });
  });

  it("accepts an explicit empty-state page as authoritative", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("<html><main>No matching jobs found</main></html>", { status: 200 })
    );
    const scraper = new GoogleScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape(
      "https://www.google.com/about/careers/applications/jobs/results"
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 0,
      openExternalIds: [],
      listingCompleteness: "complete",
    });
  });

  it("keeps earlier jobs but marks the listing partial when a later page is a challenge", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      if (url.includes("/jobs/results") && !url.includes("/jobs/results/")) {
        if (page === "2") {
          return new Response("<html><body>Verify you are human</body></html>", {
            status: 200,
          });
        }
        return new Response(
          `<a href="/about/careers/applications/jobs/results/40-role-forty">Role Forty</a>
           <a href="/about/careers/applications/jobs/results?page=2">Next</a>`,
          { status: 200 }
        );
      }
      return new Response("<main><h3>About the job</h3><p>Build things.</p></main>", {
        status: 200,
      });
    });
    const scraper = new GoogleScraper(createHttpClientStub({ fetch: fetchMock }), { detailDelayMs: 0 });

    const result = await scraper.scrape(
      "https://www.google.com/about/careers/applications/jobs/results"
    );

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 1,
      listingCompleteness: "partial",
    });
    expect(result.jobs).toHaveLength(1);
  });

  it("marks listings partial when pagination exceeds the configured safety cap", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/jobs/results") && !url.includes("/jobs/results/")) {
        return new Response(
          `<a href="/about/careers/applications/jobs/results/50-role-fifty">Role Fifty</a>
           <a href="/about/careers/applications/jobs/results?page=2">Next</a>`,
          { status: 200 }
        );
      }
      return new Response("<main><h3>About the job</h3><p>Build things.</p></main>", {
        status: 200,
      });
    });
    const scraper = new GoogleScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
      maxPages: 1,
    });

    const result = await scraper.scrape(
      "https://www.google.com/about/careers/applications/jobs/results"
    );

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 1,
      listingCompleteness: "partial",
    });
    expect(fetchMock.mock.calls.some(([calledUrl]) => new URL(calledUrl).searchParams.get("page") === "2")).toBe(false);
  });

  it("returns invalid_url before making a request for malformed source input", async () => {
    const fetchMock = vi.fn();
    const scraper = new GoogleScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape("not a URL");

    expect(result).toMatchObject({ outcome: "error", error: { code: "invalid_url" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies an HTTP listing failure through the shared status policy", async () => {
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));
    const scraper = new GoogleScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape(
      "https://www.google.com/about/careers/applications/jobs/results"
    );

    expect(result).toMatchObject({
      outcome: "error",
      error: { code: "board_not_found", statusCode: 404, retryable: false },
    });
  });
});
