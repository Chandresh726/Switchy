import { describe, expect, it, vi } from "vitest";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { EightfoldScraper } from "@/lib/scraper/platforms/eightfold";
import { LeverScraper } from "@/lib/scraper/platforms/lever";
import { OracleScraper } from "@/lib/scraper/platforms/oracle";
import { RipplingScraper } from "@/lib/scraper/platforms/rippling";
import { SmartRecruitersScraper } from "@/lib/scraper/platforms/smartrecruiters";
import { TalentBrewScraper } from "@/lib/scraper/platforms/talentbrew";
import { UberScraper } from "@/lib/scraper/platforms/uber";
import { ListingQueryOptimizer } from "@/lib/scraper/platforms/shared/query-optimizer";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

const skipDetails = { filters: { country: "India", titleKeywords: ["__skip_details__"] } };
function state() {
  const values = new Map<string, unknown>();
  return { get: (key: string) => values.get(key), set: (key: string, value: unknown) => { values.set(key, value); }, delete: (key: string) => { values.delete(key); } };
}
const browser = { bootstrap: vi.fn(), withBrowser: vi.fn(), close: vi.fn() } satisfies IBrowserClient;

function talentPage(ids: number[], total: number, size: number) {
  return `<section data-total-results="${total}" data-total-pages="${Math.ceil(total / size)}" data-records-per-page="${size}" data-ajax-url="/search-jobs/results" data-company-id="27595">
  <input data-facet-type="2" data-id="in" data-display="India"/><input data-facet-type="2" data-id="remote" data-display="Remote"/>
  ${ids.map((id) => `<li><a href="/job/city/engineer/27595/${id}"><h2>Engineer</h2><span class="location">${id === 1 ? "India" : id === 3 ? "Remote" : "USA"}</span></a></li>`).join("")}</section>`;
}

describe("optimized ATS query paths", () => {
  it("discovers native TalentBrew facets, preserves remote jobs and reuses validation on restart", async () => {
    const fetch = vi.fn(async (url: string) => {
      const p = new URL(url);
      if (!p.pathname.endsWith("/results")) return new Response(talentPage([1, 2], 4, 2));
      if (p.searchParams.get("FacetFilters[0].ID")) {
        expect(p.searchParams.get("RecordsPerPage")).toBe("100");
        expect(p.searchParams.get("FacetFilters[1].ID")).toBe("remote");
        return Response.json({ results: talentPage([1, 3], 2, 100) });
      }
      expect(p.searchParams.get("CurrentPage")).toBe("2");
      return Response.json({ results: talentPage([3, 4], 4, 2) });
    });
    const store = state();
    const make = () => new TalentBrewScraper(createHttpClientStub({ fetch }), {}, new ListingQueryOptimizer(store));
    const first = await make().scrape("https://jobs.intuit.com/search-jobs", skipDetails);
    expect(first).toMatchObject({ outcome: "success", totalListings: 2, advertisedTotal: 2, listingCompleteness: "complete" });
    expect(first.listingScopeKey).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockClear();
    expect(await make().scrape("https://jobs.intuit.com/search-jobs", skipDetails)).toMatchObject({ totalListings: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["oracle", "uber"] as const)("shares %s country and remote queries without dropping secondary-country jobs", async (platform) => {
    const fetch = vi.fn(async (url: string) => {
      const finder = new URL(url).searchParams.get("finder") ?? "";
      expect(finder).toContain("limit=200");
      const ids = finder.includes("location=India") ? [1] : finder.includes("selectedWorkplaceTypesFacet=ORA_REMOTE") ? [3] : [1, 2, 3];
      return Response.json({ items: [{ Limit: 200, Offset: 0, TotalJobsCount: ids.length, requisitionList: ids.map((id) => ({
        Id: String(id), Title: "Engineer", PrimaryLocation: id === 3 ? "Remote" : "New York", PrimaryLocationCountry: id === 3 ? null : "US",
        secondaryLocations: id === 1 ? [{ LocationName: "India" }] : [],
      })) }] });
    });
    const queries = new ListingQueryOptimizer(state(), { platforms: { [platform]: { minimumCountryListings: 0 } } });
    const http = createHttpClientStub({ fetch });
    const scraper = platform === "oracle" ? new OracleScraper(http, { listingPageSize: 1000 }, queries) : new UberScraper(http, { listingPageSize: 1000 }, queries);
    const result = await scraper.scrape(platform === "oracle" ? "https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs" : "https://www.uber.com/in/en/careers/list/", skipDetails);
    expect(result).toMatchObject({ outcome: "success", totalListings: 2, advertisedTotal: 2, listingCompleteness: "complete" });
    expect(result.listingScopeKey).toBeTruthy();
    expect(result.listingJobs?.map((job) => job.externalId.split("-").at(-1))).toEqual(["1", "3"]);
    expect(result.listingJobs?.[0].location).toContain("India");
  });

  it("uses SmartRecruiters country codes and unions globally remote jobs", async () => {
    const fetch = vi.fn(async (url: string) => {
      const p = new URL(url);
      const ids = p.searchParams.get("country") === "in" ? [1] : p.searchParams.get("locationType") === "REMOTE" ? [3] : [1, 2, 3];
      return Response.json({ totalFound: ids.length, content: ids.map((id) => ({ id, name: "Engineer", location: id === 3 ? { fullLocation: "Remote" } : { city: id === 1 ? "Bangalore" : "Boston", country: id === 1 ? "in" : "us" } })) });
    });
    const queries = new ListingQueryOptimizer(state(), { platforms: { smartrecruiters: { minimumCountryListings: 0 } } });
    const result = await new SmartRecruitersScraper(createHttpClientStub({ fetch }), {}, queries).scrape("https://jobs.smartrecruiters.com/Acme", skipDetails);
    expect(result).toMatchObject({ outcome: "success", totalListings: 2, advertisedTotal: 2 });
    expect(result.listingScopeKey).toBeTruthy();
  });

  it("preserves Eightfold query constraints and includes eligible remote positions in country requests", async () => {
    const fetch = vi.fn(async (url: string) => {
      const p = new URL(url);
      expect(p.searchParams.get("query")).toBe("Engineer");
      expect(p.searchParams.get("filter_include_remote")).toBe("1");
      const scoped = p.searchParams.get("location") === "India";
      const offset = Number(p.searchParams.get("start"));
      const ids = scoped ? [1, 2] : Array.from({ length: 10 }, (_, index) => offset + index + 1);
      return Response.json({ status: 200, data: { count: scoped ? 2 : 20, positions: ids.map((id) => ({ id, name: "Engineer", locations: [id === 1 ? "India" : id === 2 ? "Remote" : "USA"] })) } });
    });
    const queries = new ListingQueryOptimizer(state());
    const scraper = new EightfoldScraper(createHttpClientStub({ fetch }), browser, {}, queries);
    const result = await scraper.scrape("https://acme.eightfold.ai/careers?query=Engineer&filter_include_remote=1", skipDetails);
    expect(result).toMatchObject({ outcome: "success", totalListings: 2, advertisedTotal: 2 });
    expect(result.listingScopeKey).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(3);
    fetch.mockClear();
    await scraper.scrape("https://acme.eightfold.ai/careers?query=Engineer&filter_include_remote=1&location=Bangalore", skipDetails);
    expect(fetch.mock.calls.every(([url]) => new URL(url).searchParams.get("location") === "Bangalore")).toBe(true);
  });

  it("validates an Eightfold country query from a crawl resumed after a throttle", async () => {
    let throttle = true;
    const fetch = vi.fn(async (url: string) => {
      const p = new URL(url);
      if (p.searchParams.get("location") === "India") {
        return Response.json({ status: 200, data: { count: 2, positions: [1, 2].map((id) => ({ id, name: "Engineer", locations: [id === 1 ? "India" : "Remote"] })) } });
      }
      const offset = Number(p.searchParams.get("start"));
      if (offset === 20 && throttle) return new Response("limited", { status: 429, headers: { "retry-after": "60" } });
      return Response.json({ status: 200, data: { count: 30, positions: Array.from({ length: 10 }, (_, index) => {
        const id = offset + index + 1;
        return { id, name: "Engineer", locations: [id === 1 ? "India" : id === 2 ? "Remote" : "USA"] };
      }) } });
    });
    const store = state();
    const scraper = new EightfoldScraper(createHttpClientStub({ fetch }), browser, { parallelListFetches: 1 }, new ListingQueryOptimizer(store), store);
    expect(await scraper.scrape("https://acme.eightfold.ai/careers", skipDetails)).toMatchObject({ outcome: "error", error: { code: "rate_limited" } });

    throttle = false;
    const resumed = await scraper.scrape("https://acme.eightfold.ai/careers", skipDetails);
    expect(resumed).toMatchObject({ outcome: "success", totalListings: 2, listingCompleteness: "complete" });
    expect(resumed.listingScopeKey).toBeTruthy();
  });

  it("defers later Eightfold throttles with Retry-After without issuing recovery traffic", async () => {
    const fetch = vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("start"));
      if (offset) return new Response("limited", { status: 429, headers: { "retry-after": "120" } });
      return Response.json({ status: 200, data: { count: 20, positions: Array.from({ length: 10 }, (_, id) => ({ id, name: "Engineer", locations: ["India"] })) } });
    });
    const result = await new EightfoldScraper(createHttpClientStub({ fetch }), browser, { parallelListFetches: 1 })
      .scrape("https://acme.eightfold.ai/careers", skipDetails);
    expect(result).toMatchObject({ outcome: "error", error: { code: "rate_limited", retryAfterMs: 120_000 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not expand an empty Oracle first page into a one-record pagination sweep", async () => {
    const fetch = vi.fn(async (url: string) => Response.json({ items: [{
      Limit: 200, Offset: Number(new URL(url).searchParams.get("finder")?.match(/offset=(\d+)/)?.[1]),
      TotalJobsCount: 601, requisitionList: [],
    }] }));
    const result = await new OracleScraper(createHttpClientStub({ fetch }))
      .scrape("https://acme.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs", skipDetails);
    expect(result.outcome).toBe("error");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("uses returned Lever page lengths and verifies EOF when a server clamps a larger page", async () => {
    const fetch = vi.fn(async (url: string) => {
      const p = new URL(url);
      const start = Number(p.searchParams.get("skip"));
      const limit = Math.min(2, Number(p.searchParams.get("limit")));
      return Response.json(Array.from({ length: Math.min(limit, Math.max(0, 5 - start)) }, (_, index) => ({
        id: String(start + index), text: "Engineer", hostedUrl: `https://jobs.lever.co/acme/${start + index}`, categories: { location: "USA", allLocations: ["USA", "Bangalore, India"] },
      })));
    });
    const store = state();
    const make = () => new LeverScraper(createHttpClientStub({ fetch }), { listingPageSize: 2 }, new ListingQueryOptimizer(store));
    expect(await make().scrape("https://jobs.lever.co/acme")).toMatchObject({ outcome: "success", totalListings: 5, listingCompleteness: "complete" });
    fetch.mockClear();
    const result = await make().scrape("https://jobs.lever.co/acme");
    expect(result).toMatchObject({ totalListings: 5, listingCompleteness: "complete" });
    expect(result.jobs[0].locations).toEqual(["USA", "Bangalore, India"]);
    expect(fetch.mock.calls.some(([url]) => new URL(url).searchParams.get("skip") === "2")).toBe(true);
    expect(fetch.mock.calls.at(-1)?.[0]).toContain("limit=1&skip=5");
  });

  it("discovers Rippling facets and filters without excluding global remote records", async () => {
    const post = vi.fn(async (_url: string, body: unknown) => {
      const p = new URLSearchParams((body as { requests: Array<{ params: string }> }).requests[0].params);
      const filtered = Boolean(p.get("facetFilters"));
      if (filtered) expect(JSON.parse(p.get("facetFilters")!)).toEqual([["locationNames:India", "locationNames:Remote"]]);
      const ids = p.get("hitsPerPage") === "0" ? [] : filtered ? [1, 3] : [1, 2, 3];
      return { results: [{ page: 0, nbPages: 1, nbHits: filtered ? 2 : 3,
        exhaustiveFacetsCount: true, facets: { locationNames: { India: 1, USA: 1, Remote: 1 } },
        hits: ids.map((id) => ({ objectID: String(id), jobId: String(id), name: "Engineer", url: `https://example.com/${id}`,
          locations: [{ name: id === 1 ? "India" : id === 3 ? "Remote" : "USA", workplaceType: "ON_SITE" }] })),
      }] };
    });
    const queries = new ListingQueryOptimizer(state(), { platforms: { rippling: { minimumCountryListings: 0 } } });
    const scraper = new RipplingScraper(createHttpClientStub({ post: post as IHttpClient["post"] }), {}, queries);
    const first = await scraper.scrape("https://www.rippling.com/careers", skipDetails);
    expect(first).toMatchObject({ outcome: "success", totalListings: 2, listingCompleteness: "complete" });
    expect(first.listingScopeKey).toBeTruthy();
    post.mockClear();
    expect(await scraper.scrape("https://www.rippling.com/careers", skipDetails)).toMatchObject({ totalListings: 2 });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("keeps capped Algolia indexes partial instead of trusting nbPages", async () => {
    const post = vi.fn(async () => ({ results: [{ page: 0, nbPages: 1, nbHits: 50, hits: [
      { objectID: "one", jobId: "one", name: "Engineer", url: "https://example.com/one", locations: [{ name: "India", workplaceType: "ON_SITE" }] },
    ] }] }));
    const result = await new RipplingScraper(createHttpClientStub({ post: post as IHttpClient["post"] })).scrape("https://www.rippling.com/careers", skipDetails);
    expect(result).toMatchObject({ outcome: "partial", listingCompleteness: "partial", totalListings: 1 });
  });
});
