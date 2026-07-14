import { describe, expect, it, vi } from "vitest";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { WorkdayScraper } from "@/lib/scraper/platforms/workday";
import { createWorkdayListResponse } from "@test/fixtures/platforms/workday";
import {
  createBrowserClientStub,
  createHttpClientStub,
} from "@test/helpers/scraper-clients";

class FastWorkdayScraper extends WorkdayScraper {
  protected override async delay(): Promise<void> {}
}

function createBrowserClient(): IBrowserClient {
  return createBrowserClientStub({
    bootstrap: vi.fn(async () => ({
      baseUrl: "https://acme.wd5.myworkdayjobs.com",
      cookies: "session=abc",
      csrfToken: "csrf-token",
    })),
    withBrowser: vi.fn(async () => {
      throw new Error("not used");
    }),
  });
}

function createHttpClient(failedDetail?: string): IHttpClient {
  return createHttpClientStub({
    post: vi.fn(async () => createWorkdayListResponse()) as IHttpClient["post"],
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
  });
}

function createPaginatedHttpClient(failSecondPage = false): IHttpClient {
  const allJobs = createWorkdayListResponse().jobPostings.concat({
    title: "Data Engineer",
    externalPath: "/job/REQ-3",
    locationsText: "Pune, India",
    postedOn: "2026-07-02",
    remoteType: "Onsite",
    bulletFields: [],
  });

  return createHttpClientStub({
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
  });
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

  it("keeps authoritative open IDs and listing fallbacks after detail retry failure", async () => {
    const browserClient = createBrowserClient();
    const scraper = new FastWorkdayScraper(createHttpClient("REQ-2"), browserClient, {
      requestDelayBaseMs: 0,
      requestDelayJitterMs: 0,
    });

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result).toMatchObject({
      outcome: "partial",
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(2);
    expect(result.openExternalIds).toHaveLength(2);
    expect(
      result.jobs.find((job) => job.externalId === "workday-Acme-REQ-2")
        ?.description
    ).toBeUndefined();
    expect(browserClient.bootstrap).toHaveBeenCalledTimes(2);
  });

  it("recovers a transient detail failure with a refreshed session", async () => {
    const httpClient = createHttpClient();
    const originalGet = vi.mocked(httpClient.get);
    let req2Attempts = 0;
    originalGet.mockImplementation(async (url: string) => {
      const id = url.split("/").pop() ?? "";
      if (id === "REQ-2" && req2Attempts++ === 0) {
        throw new Error("expired session");
      }
      return {
        jobPostingInfo: {
          jobDescription: "Recovered description",
          timeType: "Full time",
          externalUrl: `https://acme.wd5.myworkdayjobs.com/Acme/job/${id}`,
        },
      };
    });
    const browserClient = createBrowserClient();
    const scraper = new FastWorkdayScraper(httpClient, browserClient, {
      requestDelayBaseMs: 0,
      requestDelayJitterMs: 0,
    });

    const result = await scraper.scrape(
      "https://acme.wd5.myworkdayjobs.com/Acme"
    );

    expect(result.outcome).toBe("success");
    expect(result.jobs).toHaveLength(2);
    expect(browserClient.bootstrap).toHaveBeenCalledTimes(2);
  });

  it("keeps refreshed detail retries within the configured batch size", async () => {
    const allJobs = createWorkdayListResponse().jobPostings.concat({
      title: "Data Engineer",
      externalPath: "/job/REQ-3",
      locationsText: "Pune, India",
      postedOn: "2026-07-02",
      remoteType: "Onsite",
      bulletFields: [],
    });
    const attempts = new Map<string, number>();
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const httpClient = createHttpClientStub({
      post: vi.fn(async () => ({ total: 3, jobPostings: allJobs })) as IHttpClient["post"],
      get: vi.fn(async (url: string) => {
        const id = url.split("/").pop() ?? "";
        activeRequests++;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        await Promise.resolve();
        activeRequests--;
        const attempt = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, attempt);
        if (attempt === 1) throw new Error("expired session");
        return {
          jobPostingInfo: {
            jobDescription: "Recovered description",
            timeType: "Full time",
            externalUrl: `https://acme.wd5.myworkdayjobs.com/Acme/job/${id}`,
          },
        };
      }) as IHttpClient["get"],
    });
    const scraper = new FastWorkdayScraper(httpClient, createBrowserClient(), {
      detailBatchSize: 2,
      requestDelayBaseMs: 0,
      requestDelayJitterMs: 0,
    });

    const result = await scraper.scrape(
      "https://acme.wd5.myworkdayjobs.com/Acme"
    );

    expect(result.outcome).toBe("success");
    expect(result.jobs).toHaveLength(3);
    expect(maxActiveRequests).toBe(2);
  });

  it("preserves unkeyed listings and marks their identities non-authoritative", async () => {
    const httpClient = createHttpClientStub({
      post: vi.fn(async () => ({
        total: 2,
        jobPostings: [
          { title: "Engineer I", externalPath: "" },
          { title: "Engineer II", externalPath: "" },
        ],
      })) as IHttpClient["post"],
      get: vi.fn() as IHttpClient["get"],
    });
    const scraper = new FastWorkdayScraper(httpClient, createBrowserClient(), {
      requestDelayBaseMs: 0,
      requestDelayJitterMs: 0,
    });

    const result = await scraper.scrape(
      "https://acme.wd5.myworkdayjobs.com/Acme"
    );

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 2,
      listingCompleteness: "partial",
    });
    expect(result.jobs).toHaveLength(2);
    expect(new Set(result.jobs.map((job) => job.externalId)).size).toBe(2);
    expect(new Set(result.openExternalIds).size).toBe(2);
    if (result.outcome !== "partial") throw new Error("Expected partial result");
    expect(result.issues?.[0]?.message).toContain(
      "2 listings lacked a stable Workday ID"
    );
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
    if (result.outcome !== "partial") throw new Error("Expected partial result");
    expect(result.issues?.[0]?.message).toContain(
      "2 of 3 advertised jobs"
    );
  });

  it("recovers a missing listing offset using refreshed session headers", async () => {
    const allJobs = createWorkdayListResponse().jobPostings.concat({
      title: "Data Engineer",
      externalPath: "/job/REQ-3",
      locationsText: "Pune, India",
      postedOn: "2026-07-02",
      remoteType: "Onsite",
      bulletFields: [],
    });
    let offsetTwoAttempts = 0;
    const httpClient = createHttpClientStub({
      post: vi.fn(async (_url: string, body: unknown) => {
        const offset = (body as { offset: number }).offset;
        if (offset === 2 && offsetTwoAttempts++ === 0) {
          throw new Error("expired list session");
        }
        return {
          total: 3,
          jobPostings: offset === 0 ? allJobs.slice(0, 2) : allJobs.slice(2),
        };
      }) as IHttpClient["post"],
      get: createPaginatedHttpClient().get,
    });
    const bootstrap = vi
      .fn()
      .mockResolvedValueOnce({
        baseUrl: "https://acme.wd5.myworkdayjobs.com",
        cookies: "session=old",
        csrfToken: "csrf-old",
      })
      .mockResolvedValueOnce({
        baseUrl: "https://acme.wd5.myworkdayjobs.com",
        cookies: "session=fresh",
        csrfToken: "csrf-fresh",
      });
    const browserClient = createBrowserClientStub({ bootstrap });
    const scraper = new FastWorkdayScraper(httpClient, browserClient, {
      listPageSize: 2,
      parallelListFetches: 1,
      requestDelayBaseMs: 0,
      requestDelayJitterMs: 0,
    });

    const result = await scraper.scrape(
      "https://acme.wd5.myworkdayjobs.com/Acme"
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 3,
      listingCompleteness: "complete",
    });
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(vi.mocked(httpClient.post).mock.calls.at(-1)?.[2]?.headers).toMatchObject({
      Cookie: "session=fresh",
      "x-calypso-csrf-token": "csrf-fresh",
    });
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
