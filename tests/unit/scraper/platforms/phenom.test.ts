import { describe, expect, it, vi } from "vitest";

import { PhenomScraper } from "@/lib/scraper/platforms/phenom";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

function ddoHtml(payload: unknown): string {
  return `<html><script>window.phApp = window.phApp || {}; phApp.ddo = ${JSON.stringify(payload)};</script></html>`;
}

function listing(id: string) {
  return {
    reqId: id,
    title: `Role ${id}`,
    jobUrl: `https://jobs.ebayinc.com/us/en/job/${id}/Role-${id}`,
    location: "Bengaluru, India",
    category: "Engineering",
    type: "Full time",
    postedDate: "2026-08-11T00:00:00.000+0000",
    descriptionTeaser: `Build systems ${id}.`,
    remote: "Hybrid",
  };
}

function staticListing(id: string) {
  const value = listing(id);
  return {
    reqId: value.reqId,
    title: value.title,
    location: value.location,
    category: value.category,
    type: value.type,
    postedDate: value.postedDate,
    descriptionTeaser: value.descriptionTeaser,
    remote: value.remote,
  };
}

function searchPayload(
  jobs: unknown[],
  totalHits: number,
  hits: number,
  refNum = "EBAEBAUS"
) {
  return {
    siteConfig: { data: { refNum } },
    eagerLoadRefineSearch: { hits, totalHits, data: { jobs } },
  };
}

function detailPayload(id: string) {
  return {
    jobDetail: {
      data: {
        job: {
          ...listing(id),
          description: `<h2>About</h2><p>Full description ${id}.</p>`,
        },
      },
    },
  };
}

describe("PhenomScraper", () => {
  it("detects supported Phenom hosts without accepting spoofed hosts", () => {
    const scraper = new PhenomScraper(createHttpClientStub());
    expect(scraper.validate("https://jobs.ebayinc.com/us/en/search-results")).toBe(true);
    expect(
      scraper.validate("https://careers.cisco.com/global/en/search-results")
    ).toBe(true);
    expect(scraper.validate("https://jobs.ebayinc.com.example.com/us/en/search-results")).toBe(false);
    expect(
      scraper.validate("https://careers.cisco.com.example.com/global/en/search-results")
    ).toBe(false);
    expect(scraper.extractIdentifier("https://jobs.ebayinc.com/us/en/search-results")).toBe("EBAEBAUS");
    expect(
      scraper.extractIdentifier("https://careers.cisco.com/global/en/search-results")
    ).toBe("CISCISGLOBAL");
  });

  it("preserves Cisco and Splunk search routes", async () => {
    const requestedPaths: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      requestedPaths.push(new URL(url).pathname);
      return new Response(ddoHtml(searchPayload([], 0, 0, "CISCISGLOBAL")));
    });
    const scraper = new PhenomScraper(createHttpClientStub({ fetch: fetchMock }));

    await expect(
      scraper.scrape("https://careers.cisco.com/global/en/search-results")
    ).resolves.toMatchObject({
      outcome: "success",
      detectedBoardToken: "CISCISGLOBAL",
    });
    await expect(
      scraper.scrape("https://careers.cisco.com/global/en/splunk/search-page")
    ).resolves.toMatchObject({
      outcome: "success",
      detectedBoardToken: "CISCISGLOBAL",
    });
    expect(requestedPaths).toEqual([
      "/global/en/search-results",
      "/global/en/splunk/search-page",
    ]);
  });

  it("maps Cisco remote type and secondary locations", async () => {
    const ciscoListing = {
      reqId: "2018112",
      title: "Solutions Development Architect",
      jobUrl:
        "https://careers.cisco.com/global/en/job/2018112/Solutions-Development-Architect",
      location: "Mumbai, India",
      multi_location: [
        { locationName: "Bengaluru, India" },
        { location: "Mumbai, India" },
      ],
      RemoteType: "Hybrid",
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (new URL(url).pathname.includes("/job/")) {
        const detailDdo = JSON.stringify({
          jobDetail: {
            data: {
              job: {
                reqId: ciscoListing.reqId,
                locationName: "Mumbai, India",
                multi_location: ciscoListing.multi_location,
                RemoteType: "Hybrid",
                structureData: {
                  title: ciscoListing.title,
                  description: "Build secure networking systems.",
                  employmentType: "Full time",
                  occupationalCategory: "Engineering",
                },
              },
            },
          },
        });
        return new Response(
          `<script>phApp.ddo = ${detailDdo.slice(0, -1)}; phApp.experimentData = {};</script>`
        );
      }
      return new Response(
        ddoHtml(searchPayload([ciscoListing], 1, 1, "CISCISGLOBAL"))
      );
    });
    const scraper = new PhenomScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });

    const result = await scraper.scrape(
      "https://careers.cisco.com/global/en/search-results"
    );

    expect(result).toMatchObject({
      outcome: "success",
      jobs: [
        {
          externalId: "phenom-CISCISGLOBAL-2018112",
          location: "Mumbai, India | Bengaluru, India",
          locationType: "hybrid",
        },
      ],
    });
  });

  it("paginates embedded DDO results and hydrates full descriptions", async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes("/job/")) {
        expect(new Headers(options?.headers).get("cookie")).toContain("PLAY_SESSION=session");
        const id = parsed.pathname.split("/").filter(Boolean).at(-2) ?? "";
        return new Response(ddoHtml(detailPayload(id)));
      }
      const offset = Number(parsed.searchParams.get("from") ?? 0);
      if (offset > 0) {
        expect(new Headers(options?.headers).get("cookie")).toBe(
          "PLAY_SESSION=session; PHPPPE_ACT=activity"
        );
      }
      return new Response(
        ddoHtml(
          offset === 0
            ? searchPayload([staticListing("R1"), staticListing("R2")], 3, 2)
            : searchPayload([staticListing("R3")], 3, 1)
        ),
        offset === 0
          ? {
              headers: [
                ["Set-Cookie", "PLAY_SESSION=session; Path=/; Secure; HttpOnly"],
                ["Set-Cookie", "PHPPPE_ACT=activity; Path=/; Secure"],
              ],
            }
          : undefined
      );
    });
    const scraper = new PhenomScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });

    const result = await scraper.scrape("https://jobs.ebayinc.com/us/en/search-results", {
      existingExternalIds: new Set(["phenom-EBAEBAUS-R1"]),
    });

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 3,
      listingCompleteness: "complete",
      detectedBoardToken: "EBAEBAUS",
      openExternalIds: [
        "phenom-EBAEBAUS-R1",
        "phenom-EBAEBAUS-R2",
        "phenom-EBAEBAUS-R3",
      ],
    });
    expect(result.jobs.map((job) => job.externalId)).toEqual([
      "phenom-EBAEBAUS-R2",
      "phenom-EBAEBAUS-R3",
    ]);
    expect(result.jobs[0]).toMatchObject({
      locationType: "hybrid",
      employmentType: "full-time",
      descriptionFormat: "markdown",
    });
    expect(result.jobs[0]?.url).toContain("/us/en/job/R2/Role-R2");
  });

  it("marks malformed and missing advertised jobs partial", async () => {
    const scraper = new PhenomScraper(
      createHttpClientStub({
        fetch: vi.fn(async () =>
          new Response(
            ddoHtml(searchPayload([staticListing("R1"), { reqId: "broken" }], 10, 2))
          )
        ),
      })
    );
    const result = await scraper.scrape("https://jobs.ebayinc.com/us/en/search-results", {
      existingExternalIds: new Set(["phenom-EBAEBAUS-R1"]),
    });

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 1,
      listingCompleteness: "partial",
    });
  });

  it("classifies an unavailable initial board", async () => {
    const scraper = new PhenomScraper(
      createHttpClientStub({
        fetch: vi.fn(async () => new Response("busy", { status: 429 })),
      })
    );
    await expect(
      scraper.scrape("https://jobs.ebayinc.com/us/en/search-results")
    ).resolves.toMatchObject({
      outcome: "error",
      error: { code: "rate_limited", retryable: true },
    });
  });
});
