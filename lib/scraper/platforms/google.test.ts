import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { GoogleScraper } from "@/lib/scraper/platforms/google";

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

    const scraper = new GoogleScraper(createHttpClient(fetchMock), {
      detailDelayMs: 0,
    });
    const result = await scraper.scrape(
      "https://www.google.com/about/careers/applications/jobs/results?location=India",
      { filters: { titleKeywords: ["role"] } }
    );

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("success");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.externalId).toBe("google-1");
    expect(result.openExternalIds).toEqual(["google-1", "google-2", "google-3"]);
    expect(result.openExternalIdsComplete).toBe(true);

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

    const scraper = new GoogleScraper(createHttpClient(fetchMock), {
      detailDelayMs: 0,
    });
    const result = await scraper.scrape(
      "https://www.google.com/about/careers/applications/jobs/results?location=India"
    );

    expect(result.success).toBe(true);
    expect(result.outcome).toBe("partial");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.externalId).toBe("google-10");
    expect(result.jobs[0]?.description).toBeUndefined();
    expect(result.openExternalIds).toEqual(["google-10"]);
    expect(result.openExternalIdsComplete).toBe(true);
  });
});
