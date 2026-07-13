import { describe, expect, it, vi } from "vitest";

import { GreenhouseScraper } from "@/lib/scraper/platforms/greenhouse";
import { greenhouseNullableMetadataPayload } from "@test/fixtures/platforms/production-payloads";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

describe("GreenhouseScraper", () => {
  it("extracts board token from regional job-boards URLs", () => {
    const fetchMock = vi.fn();
    const scraper = new GreenhouseScraper(createHttpClientStub({ fetch: fetchMock }));

    expect(scraper.extractIdentifier("https://job-boards.eu.greenhouse.io/groww")).toBe("groww");
    expect(scraper.extractIdentifier("https://boards.greenhouse.io/acme")).toBe("acme");
    expect(scraper.extractIdentifier("https://acme.greenhouse.io")).toBe("acme");
  });

  it("uses extracted board token from regional URL for boards API requests", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/v1/boards/groww/jobs?content=true")) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 1,
                title: "Software Engineer",
                absolute_url: "https://job-boards.eu.greenhouse.io/groww/jobs/1",
                location: { name: "Bengaluru, India" },
                departments: [{ name: "Engineering" }],
                updated_at: "2026-03-01T00:00:00Z",
                content: "<p>Role details</p>",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("not found", { status: 404 });
    });

    const scraper = new GreenhouseScraper(createHttpClientStub({ fetch: fetchMock }));
    const result = await scraper.scrape("https://job-boards.eu.greenhouse.io/groww");

    expect(result.outcome).not.toBe("error");
    expect(result.jobs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/boards/groww/jobs?content=true"),
      expect.any(Object)
    );
  });

  it("reports the failing fallback response status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("server error", { status: 500 }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    const scraper = new GreenhouseScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape("https://boards.greenhouse.io/acme");

    expect(result).toMatchObject({
      outcome: "error",
      error: { code: "auth_required", statusCode: 403, retryable: false },
    });
  });

  it("accepts nullable and polymorphic optional metadata from production feeds", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(greenhouseNullableMetadataPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const scraper = new GreenhouseScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape("https://boards.greenhouse.io/acme");

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 2,
      listingCompleteness: "complete",
    });
  });

  it("keeps valid jobs and marks the listing partial when one job is malformed", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          jobs: [
            greenhouseNullableMetadataPayload.jobs[0],
            { id: 999, absolute_url: "https://example.com/missing-title" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const result = await new GreenhouseScraper(
      createHttpClientStub({ fetch: fetchMock })
    ).scrape("https://boards.greenhouse.io/acme");

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 2,
      listingCompleteness: "partial",
    });
    expect(result.jobs).toHaveLength(1);
  });
});
