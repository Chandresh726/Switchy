import { describe, expect, it, vi } from "vitest";

import { AshbyScraper } from "@/lib/scraper/platforms/ashby";
import { ashbyNullableOptionalFieldsPayload } from "@test/fixtures/platforms/production-payloads";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

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
    const scraper = new AshbyScraper(createHttpClientStub({ fetch: fetchMock }));

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
    const scraper = new AshbyScraper(createHttpClientStub({ fetch: fetchMock }));

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
    const scraper = new AshbyScraper(createHttpClientStub({ fetch: fetchMock }));

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
    const scraper = new AshbyScraper(createHttpClientStub({ fetch: fetchMock }));

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
    const scraper = new AshbyScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape("https://jobs.ashbyhq.com/acme");

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
    });
  });

  it("accepts null for optional production fields", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(ashbyNullableOptionalFieldsPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const scraper = new AshbyScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape("https://jobs.ashbyhq.com/acme");

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
    });
  });

  it("keeps valid jobs and marks the listing partial when one job is malformed", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          jobs: [
            ashbyNullableOptionalFieldsPayload.jobs[0],
            { location: "Missing title" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const result = await new AshbyScraper(
      createHttpClientStub({ fetch: fetchMock })
    ).scrape("https://jobs.ashbyhq.com/acme");

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 2,
      listingCompleteness: "partial",
    });
    expect(result.jobs).toHaveLength(1);
  });

  it("decodes URL path identifiers for requests without changing the stable token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jobs: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    const scraper = new AshbyScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape("https://jobs.ashbyhq.com/Wisdom%20AI");

    expect(scraper.extractIdentifier("https://jobs.ashbyhq.com/Wisdom%20AI")).toBe(
      "Wisdom%20AI"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/Wisdom%20AI?"),
      expect.any(Object)
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Wisdom%2520AI"),
      expect.anything()
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/Wisdom-AI?"),
      expect.any(Object)
    );
    expect(result).toMatchObject({ detectedBoardToken: "Wisdom%20AI" });
  });

  it.each(["Wisdom%20AI", "Wisdom AI"])(
    "normalizes the legacy board token %s without changing external IDs",
    async (boardToken) => {
      const payload = {
        jobs: [
          {
            title: "Engineer",
            jobUrl: "https://jobs.ashbyhq.com/Wisdom-AI/role-1",
          },
        ],
      };
      const fallbackFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response("not found", { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      const directFetch = vi.fn(async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

      const fallbackResult = await new AshbyScraper(
        createHttpClientStub({ fetch: fallbackFetch })
      ).scrape("https://jobs.ashbyhq.com/Wisdom%20AI", { boardToken });
      const directResult = await new AshbyScraper(
        createHttpClientStub({ fetch: directFetch })
      ).scrape("https://jobs.ashbyhq.com/Wisdom%20AI", { boardToken });

      expect(fallbackFetch).not.toHaveBeenCalledWith(
        expect.stringContaining("Wisdom%2520AI"),
        expect.anything()
      );
      expect(fallbackFetch).toHaveBeenLastCalledWith(
        expect.stringContaining("/Wisdom-AI?"),
        expect.any(Object)
      );
      expect(fallbackResult.jobs[0]?.externalId).toBe(
        directResult.jobs[0]?.externalId
      );
    }
  );
});
