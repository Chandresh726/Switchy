import { describe, expect, it, vi } from "vitest";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import {
  HttpError,
  type HttpRequestOptions,
  type IHttpClient,
} from "@/lib/scraper/infrastructure/http-client";
import { WorkdayScraper } from "@/lib/scraper/platforms/workday";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

function listing(id: number) {
  return {
    title: `Engineer ${id}`,
    externalPath: `/job/REQ-${id}`,
    locationsText: "India",
    postedOn: "2026-08-20",
    remoteType: "Hybrid",
    bulletFields: [],
  };
}

function detail(id: string) {
  return {
    jobPostingInfo: {
      jobDescription: "<p>Build reliable systems.</p>",
      timeType: "Full time",
      externalUrl: `https://acme.wd5.myworkdayjobs.com/Acme/job/${id}`,
    },
  };
}

function browserClient(bootstrap = vi.fn(async () => ({
  baseUrl: "https://acme.wd5.myworkdayjobs.com",
  cookies: "session=fresh",
  csrfToken: "csrf-fresh",
}))): IBrowserClient {
  return {
    bootstrap,
    withBrowser: vi.fn(async () => {
      throw new Error("not used");
    }),
    close: vi.fn(async () => undefined),
  };
}

function directHttpClient(): IHttpClient {
  return createHttpClientStub({
    post: vi.fn(async () => ({ total: 2, jobPostings: [listing(1), listing(2)] })) as IHttpClient["post"],
    get: vi.fn(async (url: string) => detail(url.split("/").pop() ?? "")) as IHttpClient["get"],
  });
}

describe("WorkdayScraper", () => {
  it("uses direct HTTP without bootstrapping a browser on normal responses", async () => {
    const bootstrap = vi.fn(async () => {
      throw new Error("browser must remain unused");
    });
    const httpClient = directHttpClient();
    const scraper = new WorkdayScraper(httpClient, browserClient(bootstrap));

    const result = await scraper.scrape(
      "https://acme.wd5.myworkdayjobs.com/en-US/Acme"
    );

    expect(result).toMatchObject({
      outcome: "success",
      detectedBoardToken: "acme/Acme",
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(2);
    expect(bootstrap).not.toHaveBeenCalled();
    const listOptions = vi.mocked(httpClient.post).mock.calls[0]?.[2] as
      | HttpRequestOptions
      | undefined;
    const detailOptions = vi.mocked(httpClient.get).mock.calls[0]?.[1] as
      | HttpRequestOptions
      | undefined;
    expect(listOptions?.headers).not.toHaveProperty("Cookie");
    expect(listOptions?.headers).not.toHaveProperty("x-calypso-csrf-token");
    expect(detailOptions?.headers).not.toHaveProperty("Cookie");
  });

  it("maps search text and repeated source filters into the CXS payload", async () => {
    const httpClient = directHttpClient();
    const scraper = new WorkdayScraper(httpClient, browserClient());

    await scraper.scrape(
      "https://acme.wd5.myworkdayjobs.com/Acme?q=platform&locationCountry=IN&locationCountry=US&jobFamily=Engineering&page=4&utm_source=test"
    );

    expect(vi.mocked(httpClient.post).mock.calls[0]?.[1]).toEqual({
      appliedFacets: {
        locationCountry: ["IN", "US"],
        jobFamily: ["Engineering"],
      },
      limit: 20,
      offset: 0,
      searchText: "platform",
    });
  });

  it("bootstraps once on 403 and retries with session headers", async () => {
    const bootstrap = vi.fn(async () => ({
      baseUrl: "https://acme.wd5.myworkdayjobs.com",
      cookies: "session=fresh",
      csrfToken: "csrf-fresh",
    }));
    const post = vi.fn(async (
      _url: string,
      _body: unknown,
      options?: HttpRequestOptions
    ) => {
      const headers = options?.headers as Record<string, string> | undefined;
      if (!headers?.Cookie) throw new HttpError(403, "forbidden", "list");
      return { total: 1, jobPostings: [listing(1)] };
    });
    const get = vi.fn(async (
      url: string,
      options?: HttpRequestOptions
    ) => {
      const headers = options?.headers as Record<string, string> | undefined;
      expect(headers).toMatchObject({
        Cookie: "session=fresh",
        "x-calypso-csrf-token": "csrf-fresh",
      });
      return detail(url.split("/").pop() ?? "");
    });
    const scraper = new WorkdayScraper(
      createHttpClientStub({
        post: post as IHttpClient["post"],
        get: get as IHttpClient["get"],
      }),
      browserClient(bootstrap)
    );

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result.outcome).toBe("success");
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("shares a single browser fallback across concurrent 401 detail responses", async () => {
    const bootstrap = vi.fn(async () => ({
      baseUrl: "https://acme.wd5.myworkdayjobs.com",
      cookies: "session=fresh",
      csrfToken: "csrf-fresh",
    }));
    const httpClient = createHttpClientStub({
      post: vi.fn(async () => ({ total: 2, jobPostings: [listing(1), listing(2)] })) as IHttpClient["post"],
      get: vi.fn(async (url: string, options?: HttpRequestOptions) => {
        const headers = options?.headers as Record<string, string> | undefined;
        if (!headers?.Cookie) throw new HttpError(401, "unauthorized", url);
        return detail(url.split("/").pop() ?? "");
      }) as IHttpClient["get"],
    });
    const scraper = new WorkdayScraper(httpClient, browserClient(bootstrap));

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result.outcome).toBe("success");
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it("retains listing fallbacks when detail-session bootstrap fails", async () => {
    const bootstrap = vi.fn(async () => ({
      baseUrl: "https://acme.wd5.myworkdayjobs.com",
      cookies: "",
      csrfToken: "",
    }));
    const httpClient = createHttpClientStub({
      post: vi.fn(async () => ({ total: 1, jobPostings: [listing(1)] })) as IHttpClient["post"],
      get: vi.fn(async (url: string) => {
        throw new HttpError(403, "forbidden", url);
      }) as IHttpClient["get"],
    });
    const scraper = new WorkdayScraper(httpClient, browserClient(bootstrap));

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 1,
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      externalId: "workday-Acme-REQ-1",
      title: "Engineer 1",
    });
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  it("fetches no more than six listing pages concurrently", async () => {
    const pageSize = 20;
    const total = 140;
    let active = 0;
    let maxActive = 0;
    const post = vi.fn(async (_url: string, body: unknown) => {
      const offset = (body as { offset: number }).offset;
      if (offset > 0) {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
      }
      return {
        total,
        jobPostings: Array.from(
          { length: Math.min(pageSize, total - offset) },
          (_, index) => listing(offset + index + 1)
        ),
      };
    });
    const scraper = new WorkdayScraper(
      createHttpClientStub({
        post: post as IHttpClient["post"],
        get: vi.fn() as IHttpClient["get"],
      }),
      browserClient(),
      { parallelListFetches: 6 }
    );

    const result = await scraper.scrape(
      "https://acme.wd5.myworkdayjobs.com/Acme",
      { filters: { titleKeywords: ["does-not-match"] } }
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 140,
      listingCompleteness: "complete",
    });
    expect(maxActive).toBe(6);
  });

  it("retries a missing offset without browser and protects completeness", async () => {
    const bootstrap = vi.fn(async () => {
      throw new Error("generic failures must not start a browser");
    });
    const post = vi.fn(async (_url: string, body: unknown) => {
      const offset = (body as { offset: number }).offset;
      if (offset === 20) throw new Error("page unavailable");
      return {
        total: 21,
        jobPostings: Array.from({ length: 20 }, (_, index) => listing(index + 1)),
      };
    });
    const scraper = new WorkdayScraper(
      createHttpClientStub({
        post: post as IHttpClient["post"],
        get: vi.fn(async (url: string) => detail(url.split("/").pop() ?? "")) as IHttpClient["get"],
      }),
      browserClient(bootstrap)
    );

    const result = await scraper.scrape("https://acme.wd5.myworkdayjobs.com/Acme");

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 20,
      listingCompleteness: "partial",
    });
    expect(result.openExternalIds).toHaveLength(20);
    expect(post.mock.calls.filter(([, body]) => (body as { offset: number }).offset === 20)).toHaveLength(2);
    expect(bootstrap).not.toHaveBeenCalled();
  });
});
