import { describe, expect, it, vi } from "vitest";

import type { IHttpClient, HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import { NutanixScraper } from "@/lib/scraper/platforms/nutanix";

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

describe("NutanixScraper", () => {
  it("maps every entry from a valid authoritative XML feed", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
          <jobs>
            <job>
              <title>Staff Engineer</title>
              <date>2026-07-01T00:00:00.000Z</date>
              <apijobid>123</apijobid>
              <url>https://careers.nutanix.com/jobs/123</url>
              <city>Bengaluru</city><state>Karnataka</state><country>India</country>
              <description><![CDATA[<p>Distributed systems</p>]]></description>
              <category>Engineering</category>
            </job>
          </jobs>`,
        { status: 200, headers: { "Content-Type": "application/xml" } }
      )
    );
    const scraper = new NutanixScraper(createHttpClient(fetchMock));

    const result = await scraper.scrape("https://careers.nutanix.com/jobs");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://careers.nutanix.com/en/jobs/xml/?rss=true",
      expect.any(Object)
    );
    expect(result).toMatchObject({
      success: true,
      outcome: "success",
      detectedBoardToken: "nutanix",
      openExternalIdsComplete: true,
    });
    expect(result.jobs).toEqual([
      expect.objectContaining({
        externalId: "nutanix-nutanix-123",
        title: "Staff Engineer",
        location: "Bengaluru, Karnataka, India",
        department: "Engineering",
        descriptionFormat: "html",
      }),
    ]);
  });

  it("characterizes an empty but readable feed as partial", async () => {
    const fetchMock = vi.fn(async () => new Response("<jobs />", { status: 200 }));
    const scraper = new NutanixScraper(createHttpClient(fetchMock));

    const result = await scraper.scrape("https://careers.nutanix.com/jobs");

    expect(result).toMatchObject({
      success: true,
      outcome: "partial",
      jobs: [],
      openExternalIds: [],
      openExternalIdsComplete: true,
    });
  });
});
