import { describe, expect, it, vi } from "vitest";

import type { IHttpClient, HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import { AshbyScraper } from "@/lib/scraper/platforms/ashby";

type FetchMock = ReturnType<
  typeof vi.fn<(url: string, options?: HttpRequestOptions) => Promise<Response>>
>;

function createHttpClient(fetchMock: FetchMock): IHttpClient {
  return {
    fetch: fetchMock,
    get: vi.fn() as IHttpClient["get"],
    post: vi.fn() as IHttpClient["post"],
  };
}

describe("AshbyScraper", () => {
  it("extracts the board name and maps an authoritative job-board response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          apiVersion: "1",
          jobs: [
            {
              title: "Senior Software Engineer",
              location: "Bengaluru, India",
              team: "Platform",
              descriptionHtml: "<p>Build reliable systems.</p>",
              publishedAt: "2026-07-01T00:00:00.000Z",
              employmentType: "FullTime",
              jobUrl: "https://jobs.ashbyhq.com/acme/role-1",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const scraper = new AshbyScraper(createHttpClient(fetchMock));

    const result = await scraper.scrape("https://jobs.ashbyhq.com/acme");

    expect(scraper.extractIdentifier("https://jobs.ashbyhq.com/acme/role-1")).toBe("acme");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/posting-api/job-board/acme?includeCompensation=true"),
      expect.any(Object)
    );
    expect(result).toMatchObject({
      outcome: "success",
      detectedBoardToken: "acme",
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      title: "Senior Software Engineer",
      location: "Bengaluru, India",
      department: "Platform",
      employmentType: "full-time",
      descriptionFormat: "markdown",
    });
    expect(result.openExternalIds).toEqual([result.jobs[0]?.externalId]);
  });

  it("returns an error without calling the API when no board can be determined", async () => {
    const fetchMock = vi.fn();
    const scraper = new AshbyScraper(createHttpClient(fetchMock));

    const result = await scraper.scrape("https://example.com/");

    expect(result).toMatchObject({ outcome: "error", jobs: [] });
    expect(result.error).toMatchObject({
      code: "invalid_url",
      message: expect.stringContaining("Could not determine Ashby job board name"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a typed parse error when the upstream shape drifts", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ apiVersion: "1", jobs: [{ location: "Remote" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const scraper = new AshbyScraper(createHttpClient(fetchMock));

    const result = await scraper.scrape("https://jobs.ashbyhq.com/acme");

    expect(result).toMatchObject({
      outcome: "error",
      listingCompleteness: "unknown",
      error: {
        code: "parse_error",
        retryable: false,
      },
    });
  });

  it("classifies direct HTTP failures through the shared status policy", async () => {
    const fetchMock = vi.fn(async () => new Response("forbidden", { status: 403 }));
    const scraper = new AshbyScraper(createHttpClient(fetchMock));

    const result = await scraper.scrape("https://jobs.ashbyhq.com/acme");

    expect(result).toMatchObject({
      outcome: "error",
      error: { code: "auth_required", retryable: false, statusCode: 403 },
    });
  });

  it("accepts a minimal usable payload without unused metadata", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ jobs: [{ title: "Engineer" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const scraper = new AshbyScraper(createHttpClient(fetchMock));

    const result = await scraper.scrape("https://jobs.ashbyhq.com/acme");

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
    });
  });
});
