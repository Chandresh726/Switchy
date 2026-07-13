import { describe, expect, it, vi } from "vitest";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { WorkdayScraper } from "@/lib/scraper/platforms/workday";

vi.mock("@/lib/scraper/services", () => ({
  hasEarlyFilters: vi.fn(() => false),
  applyEarlyFilters: vi.fn((items: unknown[]) => ({
    filtered: items,
    filteredOut: 0,
    breakdown: { country: 0, city: 0, title: 0 },
  })),
  toEarlyFilterStats: vi.fn(() => undefined),
}));

class FastWorkdayScraper extends WorkdayScraper {
  protected override async delay(): Promise<void> {}
}

function createBrowserClient(): IBrowserClient {
  return {
    bootstrap: vi.fn(async () => ({
      baseUrl: "https://acme.wd5.myworkdayjobs.com",
      cookies: "session=abc",
      csrfToken: "csrf-token",
    })),
    withBrowser: vi.fn(async () => {
      throw new Error("not used");
    }),
    close: vi.fn(async () => undefined),
  };
}

function createListResponse() {
  return {
    total: 2,
    jobPostings: [
      {
        title: "Platform Engineer",
        externalPath: "/job/REQ-1",
        locationsText: "Bengaluru, India",
        postedOn: "2026-07-01",
        remoteType: "Hybrid",
        bulletFields: [],
      },
      {
        title: "Site Reliability Engineer",
        externalPath: "/job/REQ-2",
        locationsText: "Remote",
        postedOn: "Posted 2 days ago",
        remoteType: "Remote",
        bulletFields: [],
      },
    ],
  };
}

function createHttpClient(failedDetail?: string): IHttpClient {
  return {
    fetch: vi.fn() as IHttpClient["fetch"],
    post: vi.fn(async () => createListResponse()) as IHttpClient["post"],
    get: vi.fn(async (url: string) => {
      const id = url.split("/").pop() ?? "";
      if (id === failedDetail) throw new Error("detail unavailable");
      return {
        jobPostingInfo: {
          id,
          title: id === "REQ-1" ? "Platform Engineer" : "Site Reliability Engineer",
          jobDescription: "<p>Build dependable services.</p>",
          location: "Bengaluru",
          postedOn: "2026-07-01",
          startDate: "",
          timeType: "Full time",
          jobReqId: id,
          jobPostingId: id,
          remoteType: "",
          externalUrl: `https://acme.wd5.myworkdayjobs.com/Acme/job/${id}`,
        },
      };
    }) as IHttpClient["get"],
  };
}

function createPaginatedHttpClient(failSecondPage = false): IHttpClient {
  const allJobs = createListResponse().jobPostings.concat({
    title: "Data Engineer",
    externalPath: "/job/REQ-3",
    locationsText: "Pune, India",
    postedOn: "2026-07-02",
    remoteType: "Onsite",
    bulletFields: [],
  });

  return {
    fetch: vi.fn() as IHttpClient["fetch"],
    post: vi.fn(async (_url: string, body: unknown) => {
      const offset = (body as { offset: number }).offset;
      if (offset === 2 && failSecondPage) throw new Error("page unavailable");
      return {
        total: 3,
        jobPostings: offset === 0 ? allJobs.slice(0, 2) : allJobs.slice(2),
      };
    }) as IHttpClient["post"],
    get: vi.fn(async (url: string) => {
      const id = url.split("/").pop() ?? "";
      return {
        jobPostingInfo: {
          id,
          title: id,
          jobDescription: "Description",
          location: "India",
          postedOn: "2026-07-01",
          startDate: "",
          timeType: "Full time",
          jobReqId: id,
          jobPostingId: id,
          remoteType: "",
          externalUrl: `https://acme.wd5.myworkdayjobs.com/Acme/job/${id}`,
        },
      };
    }) as IHttpClient["get"],
  };
}

describe("WorkdayScraper", () => {
  it("bootstraps a session and hydrates an authoritative listing", async () => {
    const httpClient = createHttpClient();
    const browserClient = createBrowserClient();
    const scraper = new FastWorkdayScraper(httpClient, browserClient, {
      requestDelayBaseMs: 0,
      requestDelayJitterMs: 0,
    });

    const result = await scraper.scrape(
      "https://acme.wd5.myworkdayjobs.com/en-US/Acme"
    );

    expect(scraper.extractIdentifier("https://acme.wd5.myworkdayjobs.com/en-US/Acme")).toBe(
      "acme/Acme"
    );
    expect(browserClient.bootstrap).toHaveBeenCalledWith(
      "https://acme.wd5.myworkdayjobs.com/Acme"
    );
    expect(result).toMatchObject({
      outcome: "success",
      detectedBoardToken: "acme/Acme",
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({
      externalId: "workday-Acme-REQ-1",
      locationType: "hybrid",
      descriptionFormat: "markdown",
    });
    expect(httpClient.post).toHaveBeenCalledWith(
      expect.stringContaining("/wday/cxs/acme/Acme/jobs"),
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: "session=abc",
          "x-calypso-csrf-token": "csrf-token",
        }),
      })
    );
  });

  it("keeps the authoritative open-id set but reports partial detail hydration", async () => {
    const scraper = new FastWorkdayScraper(createHttpClient("REQ-2"), createBrowserClient(), {
      requestDelayBaseMs: 0,
      requestDelayJitterMs: 0,
    });

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result).toMatchObject({
      outcome: "partial",
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.openExternalIds).toHaveLength(2);
  });

  it("marks a successful multi-page listing authoritative", async () => {
    const scraper = new FastWorkdayScraper(createPaginatedHttpClient(), createBrowserClient(), {
      listPageSize: 2,
      parallelListFetches: 1,
      requestDelayBaseMs: 0,
      requestDelayJitterMs: 0,
    });

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result).toMatchObject({
      outcome: "success",
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(3);
    expect(result.openExternalIds).toHaveLength(3);
  });

  it("marks a listing incomplete when a later Workday page fails", async () => {
    const scraper = new FastWorkdayScraper(
      createPaginatedHttpClient(true),
      createBrowserClient(),
      {
        listPageSize: 2,
        parallelListFetches: 1,
        requestDelayBaseMs: 0,
        requestDelayJitterMs: 0,
      }
    );

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result).toMatchObject({
      outcome: "partial",
      listingCompleteness: "partial",
    });
    expect(result.jobs).toHaveLength(2);
    expect(result.openExternalIds).toHaveLength(2);
  });

  it("returns a typed parse error when the Workday list shape drifts", async () => {
    const httpClient = createHttpClient();
    vi.mocked(httpClient.post).mockResolvedValue({
      total: "two",
      jobPostings: [],
    });
    const scraper = new FastWorkdayScraper(httpClient, createBrowserClient());

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result).toMatchObject({
      outcome: "error",
      listingCompleteness: "unknown",
      error: { code: "parse_error", retryable: false },
    });
  });

  it("accepts minimal list and detail payloads by defaulting optional fields", async () => {
    const httpClient = createHttpClient();
    vi.mocked(httpClient.post).mockResolvedValue({
      total: 1,
      jobPostings: [{ title: "Engineer", externalPath: "/job/REQ-1" }],
    });
    vi.mocked(httpClient.get).mockResolvedValue({ jobPostingInfo: {} });
    const scraper = new FastWorkdayScraper(httpClient, createBrowserClient());

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(1);
  });
});
