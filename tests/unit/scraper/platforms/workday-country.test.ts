import { describe, expect, it, vi } from "vitest";

import { WorkdayScraper } from "@/lib/scraper/platforms/workday";
import { DefaultFilterService } from "@/lib/scraper/services/filter-service";
import { HttpError, type IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

const url = "https://acme.wd5.myworkdayjobs.com/External";
const options = { filters: { country: "India", titleKeywords: ["no-details"] } };
const job = (id: number, location = "India") => ({ title: `Engineer ${id}`, externalPath: `/job/REQ-${id}`, locationsText: location });
const browser: IBrowserClient = { bootstrap: vi.fn(), withBrowser: vi.fn(), close: vi.fn() };
function store() {
  const data = new Map<string, unknown>();
  return { get: (key: string) => data.get(key), set: (key: string, value: unknown) => { data.set(key, value); }, delete: (key: string) => { data.delete(key); } };
}
const countryFacet = [{ facetParameter: "locationMainGroup", values: [{ facetParameter: "custom_country", descriptor: "Country", values: [
  { id: "in", descriptor: "India", count: 2 }, { id: "us", descriptor: "United States", count: 21 },
] }] }];

describe("Workday country discovery and coverage", () => {
  it("discovers a custom nested country facet, preserves category filters and keeps later-page totals independent", async () => {
    const post = vi.fn(async (_url: string, body: unknown) => {
      const query = body as { appliedFacets: Record<string, string[]>; offset: number; limit: number };
      expect(query.limit).toBe(20);
      expect(query.appliedFacets.category).toEqual(["engineering"]);
      return query.appliedFacets.custom_country
        ? { total: 2, jobPostings: [job(1, "2 Locations"), job(2)] }
        : { total: 23, jobPostings: Array.from({ length: 20 }, (_, id) => job(id + 1, id < 2 ? "India" : "USA")), facets: countryFacet };
    });
    const result = await new WorkdayScraper(createHttpClientStub({ post: post as IHttpClient["post"] }), browser, { listDelayMs: 0 }, store())
      .scrape(`${url}?category=engineering`, options);
    expect(post).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ outcome: "success", totalListings: 2, listingCompleteness: "complete" });
    expect(result.listingJobs?.[0]).toMatchObject({ location: "2 Locations", country: "India" });
    expect(result.listingScopeKey).toBeTruthy();
  });

  it("validates inferred location sets once, reuses the proof after restart and invalidates it for changed facets", async () => {
    let changed = false;
    const facets = () => [{ facetParameter: "locations", values: [
      { id: "in", descriptor: "India, Bangalore", count: 5 }, { id: "us", descriptor: "USA", count: 18 },
      ...(changed ? [{ id: "new", descriptor: "Bengaluru", count: 1 }] : []),
    ] }];
    const post = vi.fn(async (_url: string, body: unknown) => {
      const q = body as { appliedFacets: Record<string, string[]>; offset: number };
      if (q.appliedFacets.locations) return { total: 5, jobPostings: Array.from({ length: 5 }, (_, id) => job(id + 1)) };
      return { total: q.offset ? 0 : 23, jobPostings: Array.from({ length: q.offset ? 3 : 20 }, (_, index) => {
        const id = q.offset + index + 1;
        return job(id, id <= 5 ? "India" : changed && id === 6 ? "Bengaluru" : "USA");
      }), facets: q.offset ? [] : facets() };
    });
    const state = store();
    const make = () => new WorkdayScraper(createHttpClientStub({ post: post as IHttpClient["post"] }), browser, { listDelayMs: 0 }, state);
    expect(await make().scrape(url, options)).toMatchObject({ totalListings: 5, listingCompleteness: "complete" });
    expect(post).toHaveBeenCalledTimes(3); // Discovery, remaining baseline page, filtered query.
    post.mockClear();
    expect(await make().scrape(url, options)).toMatchObject({ totalListings: 5 });
    expect(post).toHaveBeenCalledTimes(2); // Discovery and filtered query only.
    changed = true; post.mockClear();
    expect(await make().scrape(url, options)).toMatchObject({ totalListings: 23, listingCompleteness: "complete" });
    expect(post).toHaveBeenCalledTimes(3); // Coverage fails for the newly unmapped Indian location.
  });

  it("falls back when a server ignores the discovered country filter", async () => {
    const postings = [job(1), job(2), job(3, "USA")];
    const post = vi.fn(async () => ({ total: 3, jobPostings: postings, facets: countryFacet }));
    const result = await new WorkdayScraper(createHttpClientStub({ post: post as IHttpClient["post"] }), browser, { listDelayMs: 0 }, store()).scrape(url, options);
    expect(result).toMatchObject({ totalListings: 3, listingCompleteness: "complete" });
    expect(result.listingJobs?.[0].country).toBeUndefined();
  });

  it("does not disguise a rate limit as filter failure or issue a fallback crawl", async () => {
    const post = vi.fn(async (_url: string, body: unknown) => {
      if ((body as { appliedFacets: Record<string, unknown> }).appliedFacets.custom_country) {
        throw new HttpError(429, "rate limited", url, new Headers({ "retry-after": "120" }));
      }
      return { total: 3, jobPostings: [job(1), job(2), job(3, "USA")], facets: countryFacet };
    });
    const result = await new WorkdayScraper(createHttpClientStub({ post: post as IHttpClient["post"] }), browser, { listDelayMs: 0 }, store()).scrape(url, options);
    expect(result).toMatchObject({ outcome: "error", error: { code: "rate_limited", retryAfterMs: 120_000 } });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("retains the configured query when a board rejects a country parameter, including after restart", async () => {
    const post = vi.fn(async (_url: string, body: unknown) => {
      if ((body as { appliedFacets: Record<string, unknown> }).appliedFacets.custom_country) {
        throw new HttpError(400, "unsupported parameter", url);
      }
      return { total: 3, jobPostings: [job(1), job(2), job(3, "USA")], facets: countryFacet };
    });
    const state = store();
    const make = () => new WorkdayScraper(createHttpClientStub({ post: post as IHttpClient["post"] }), browser, { listDelayMs: 0 }, state);
    expect(await make().scrape(url, options)).toMatchObject({ totalListings: 3, listingCompleteness: "complete" });
    expect(post).toHaveBeenCalledTimes(2);
    post.mockClear();
    expect(await make().scrape(url, options)).toMatchObject({ totalListings: 3 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("keeps a scoped query partial when the source returns a listing without its identity fields", async () => {
    const post = vi.fn(async (_url: string, body: unknown) => ({
      total: 2,
      jobPostings: (body as { appliedFacets: Record<string, unknown> }).appliedFacets.custom_country
        ? [job(1), { bulletFields: ["REQ-2"] }]
        : [job(1), job(2, "USA")],
      facets: countryFacet,
    }));
    const state = store();
    const result = await new WorkdayScraper(createHttpClientStub({ post: post as IHttpClient["post"] }), browser, { listDelayMs: 0 }, state)
      .scrape(url, options);
    expect(result).toMatchObject({ outcome: "partial", totalListings: 1, advertisedTotal: 2, listingCompleteness: "partial" });
    if (result.outcome === "error") throw new Error(result.error.message);
    expect(result.issues?.[0].message).toMatch(/title, externalPath/);
  });

  it("always exposes the advertised total for tolerated duplicate listings without detail downloads", async () => {
    const http = createHttpClientStub({
      post: vi.fn(async () => ({ total: 2, jobPostings: [job(1), job(1)] })) as IHttpClient["post"],
    });
    const result = await new WorkdayScraper(http, browser, { listDelayMs: 0 }).scrape(url, options);
    expect(result).toMatchObject({ outcome: "success", totalListings: 1, advertisedTotal: 2 });
    if (result.outcome === "error") throw new Error(result.error.message);
    expect(result.issues?.[0].message).toMatch(/1 of 2 advertised/);
    expect(http.get).not.toHaveBeenCalled();
  });

  it("retains descriptions when optional detail metadata has an unexpected shape", async () => {
    const http = createHttpClientStub({
      post: vi.fn(async () => ({ total: 1, jobPostings: [job(1)] })) as IHttpClient["post"],
      get: vi.fn(async () => ({ jobPostingInfo: {
        jobDescription: "Build reliable systems.", country: "India", location: { descriptor: "Bangalore" },
        startDate: { date: "2026-11-27" }, additionalLocations: [null],
      } })) as IHttpClient["get"],
    });
    const result = await new WorkdayScraper(http, browser, { listDelayMs: 0 }).scrape(url);
    expect(result).toMatchObject({ outcome: "success", jobs: [{ description: "Build reliable systems.", location: "India" }] });
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it("does not let the primary detail country exclude another advertised job location", async () => {
    const http = createHttpClientStub({
      post: vi.fn(async () => ({ total: 1, jobPostings: [job(1, "India / USA")] })) as IHttpClient["post"],
      get: vi.fn(async () => ({ jobPostingInfo: {
        jobDescription: "Build reliable systems.", country: { descriptor: "United States" },
        location: "USA", additionalLocations: ["Bangalore, India"],
      } })) as IHttpClient["get"],
    });
    const result = await new WorkdayScraper(http, browser, { listDelayMs: 0 }).scrape(url, { filters: { country: "India" } });
    expect(result).toMatchObject({ outcome: "success", jobs: [{ location: "India / USA", locations: ["USA", "Bangalore, India"] }] });
    expect(new DefaultFilterService().matchesFilters(result.jobs[0], { country: "India" })).toBe(true);
  });

  it.each([false, true])("never calls a capped or repeated query complete, repeated=%s", async (repeated) => {
    const post = vi.fn(async (_url: string, body: unknown) => {
      const q = body as { offset: number };
      return { total: repeated ? 60 : 40, jobPostings: Array.from({ length: 20 }, (_, id) => job((repeated ? 0 : q.offset) + id + 1)) };
    });
    const result = await new WorkdayScraper(createHttpClientStub({ post: post as IHttpClient["post"] }), browser,
      { listDelayMs: 0, queryResultLimit: repeated ? 2000 : 40 }).scrape(url, { filters: { titleKeywords: ["no-details"] } });
    expect(result).toMatchObject({ outcome: "partial", listingCompleteness: "partial" });
    if (result.outcome !== "error") expect(result.issues?.[0].message).toMatch(repeated ? /Repeated listing page/ : /result ceiling/);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("preserves a genuine throttle when a parallel peer returns a repeated page", async () => {
    const post = vi.fn(async (_url: string, body: unknown) => {
      if ((body as { offset: number }).offset === 40) {
        throw new HttpError(429, "rate limited", url, new Headers({ "retry-after": "120" }));
      }
      return { total: 60, jobPostings: Array.from({ length: 20 }, (_, id) => job(id + 1)) };
    });
    const result = await new WorkdayScraper(createHttpClientStub({ post: post as IHttpClient["post"] }), browser,
      { listDelayMs: 0, parallelListFetches: 2 }, store()).scrape(url, options);
    expect(result).toMatchObject({ outcome: "error", error: { code: "rate_limited", retryAfterMs: 120_000 } });
    expect(post).toHaveBeenCalledTimes(3);
  });
});
