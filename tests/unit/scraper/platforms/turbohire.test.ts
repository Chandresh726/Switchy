import { describe, expect, it, vi } from "vitest";

import type { HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import { TurboHireScraper } from "@/lib/scraper/platforms/turbohire";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

const sourceUrl =
  "https://flipkart.turbohire.co/careerpage/4d757ba0-3d57-448a-b82c-238ed87ac90f";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function job(id = 101) {
  return {
    JobId: id,
    JobIdObfuscated: `obfuscated%2F${id}`,
    JobTitle: "Software Engineer",
    Department: "Engineering",
    PublishedDate: "2026-08-20T00:00:00Z",
    Location: "Bengaluru, India",
    Type: "Full time",
    JobDescV2: "<p>Build reliable commerce systems.</p>",
  };
}

describe("TurboHireScraper", () => {
  it("uses guest-token origin headers and the verified unfiltered payload", async () => {
    const fetchMock = vi.fn(async (url: string, options?: HttpRequestOptions) => {
      void options;
      return url.includes("/token/noauth")
        ? json({ access_token: "guest", token_type: "Bearer", expires_in: 3600 })
        : json({ Total: 1, Result: [job()] });
    });
    const scraper = new TurboHireScraper(
      createHttpClientStub({ fetch: fetchMock })
    );

    const result = await scraper.scrape(sourceUrl);

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      detectedBoardToken: "4d757ba0-3d57-448a-b82c-238ed87ac90f",
      openExternalIds: [
        "turbohire-4d757ba0-3d57-448a-b82c-238ed87ac90f-101",
      ],
      listingCompleteness: "complete",
    });
    expect(result.jobs[0]).toMatchObject({
      title: "Software Engineer",
      url: "https://flipkart.turbohire.co/job/publicjobs/obfuscated%2F101",
      department: "Engineering",
      employmentType: "full-time",
      descriptionFormat: "markdown",
    });
    expect(result.jobs[0]?.url).not.toContain("%252F");

    const calls = fetchMock.mock.calls;
    expect(calls[0]?.[1]?.headers).toMatchObject({
      Origin: "https://flipkart.turbohire.co",
      Referer: "https://flipkart.turbohire.co/",
    });
    expect(calls[1]?.[0]).toContain(
      "/careerpagev2/filteredjobs?orgId=4d757ba0-3d57-448a-b82c-238ed87ac90f&pageType=0"
    );
    expect(calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer guest",
      Origin: "https://flipkart.turbohire.co",
    });
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
      SortByV2: { Key: "PostedDate", Order: 2 },
      BunitIds: { Value: null, FilterType: 0 },
      Experience: { Value: null, FilterType: 0 },
      JobTypes: { Value: null, FilterType: 0 },
      JobTypeV2: { Value: null, FilterType: 0 },
      Locations: { Value: null, FilterType: 0 },
      CreatedDate: { Value: null, FilterType: 0 },
      Compensation: { Value: null, FilterType: 0 },
      Skills: { Value: null, FilterType: 0 },
      Keyword: "",
      ClientIds: { Value: null, FilterType: 0 },
      Department: "",
      CustomFields: {},
    });
  });

  it("refreshes the guest token once after an authorization failure", async () => {
    let tokenCalls = 0;
    let jobCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/token/noauth")) {
        tokenCalls++;
        return json({
          access_token: `guest-${tokenCalls}`,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      jobCalls++;
      return jobCalls === 1
        ? new Response("expired", { status: 401 })
        : json({ Total: 1, Result: [job()] });
    });

    const result = await new TurboHireScraper(
      createHttpClientStub({ fetch: fetchMock })
    ).scrape(sourceUrl);

    expect(result.outcome).toBe("success");
    expect(tokenCalls).toBe(2);
    expect(jobCalls).toBe(2);
  });

  it("marks short and malformed result sets partial", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/token/noauth")
        ? json({ access_token: "guest", token_type: "Bearer", expires_in: 3600 })
        : json({ Total: 3, Result: [job(), { JobId: 102 }] })
    );

    const result = await new TurboHireScraper(
      createHttpClientStub({ fetch: fetchMock })
    ).scrape(sourceUrl);

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 1,
      listingCompleteness: "partial",
    });
    expect(result.jobs).toHaveLength(1);
  });

  it("requires a UUID for noncanonical custom source URLs", async () => {
    const fetchMock = vi.fn();
    const scraper = new TurboHireScraper(
      createHttpClientStub({ fetch: fetchMock })
    );

    const missing = await scraper.scrape("https://careers.example.com/jobs");
    expect(missing).toMatchObject({
      outcome: "error",
      error: { code: "board_not_found" },
    });
    expect(fetchMock).not.toHaveBeenCalled();

    expect(scraper.validate(sourceUrl)).toBe(true);
    expect(scraper.validate("https://flipkart.turbohire.co/careerpage/not-a-uuid")).toBe(false);
  });
});
