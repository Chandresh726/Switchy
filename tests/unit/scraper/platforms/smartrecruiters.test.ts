import { describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { SmartRecruitersScraper } from "@/lib/scraper/platforms/smartrecruiters";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

const SOURCE_URL = "https://careers.smartrecruiters.com/PHONEPELIMITED";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function listing(id: string, name = `Role ${id}`) {
  return {
    id,
    name,
    releasedDate: "2026-08-28T11:18:19.724Z",
    location: {
      fullLocation: "Pune, Maharashtra, India",
      remote: false,
      hybrid: false,
    },
    function: { label: "Engineering" },
    typeOfEmployment: { id: "permanent", label: "Full-time" },
    experienceLevel: { label: "mid_senior_level" },
  };
}

function detail(id: string, overrides: Record<string, unknown> = {}) {
  return {
    ...listing(id, "Engineering Manager, Backend"),
    postingUrl: `https://jobs.smartrecruiters.com/PHONEPELIMITED/${id}-engineering-manager-backend`,
    customField: [
      { fieldLabel: "Department Name", valueLabel: "Business Technology" },
    ],
    jobAd: {
      sections: {
        companyDescription: { title: "Company Description", text: "<p>PhonePe builds products.</p>" },
        jobDescription: { title: "Job Description", text: "<p>Build backend systems.</p>" },
        qualifications: { title: "Qualifications", text: "<ul><li>Java</li></ul>" },
        additionalInformation: { title: "Additional Information", text: "<p>Apply today.</p>" },
      },
    },
    ...overrides,
  };
}

function scraperWithFetch(
  fetchMock: ReturnType<typeof vi.fn>,
  config: ConstructorParameters<typeof SmartRecruitersScraper>[1] = {}
) {
  return new SmartRecruitersScraper(
    createHttpClientStub({ fetch: fetchMock as IHttpClient["fetch"] }),
    { detailDelayMs: 0, ...config }
  );
}

describe("SmartRecruitersScraper", () => {
  it("detects only canonical hosts and preserves identifier case", () => {
    const scraper = scraperWithFetch(vi.fn());

    expect(scraper.validate("https://careers.smartrecruiters.com/PhonePeLimited/jobs")).toBe(true);
    expect(scraper.validate("https://jobs.smartrecruiters.com/PHONEPELIMITED/123-role")).toBe(true);
    expect(scraper.extractIdentifier("https://careers.smartrecruiters.com/PhonePeLimited/jobs")).toBe("PhonePeLimited");
    expect(scraper.extractIdentifier("https://jobs.smartrecruiters.com/PHONEPELIMITED/123-role")).toBe("PHONEPELIMITED");
    expect(scraper.validate("https://careers.smartrecruiters.com.example.com/PHONEPELIMITED")).toBe(false);
    expect(scraper.validate("https://smartrecruiters.example.com/PHONEPELIMITED")).toBe(false);
    expect(scraper.extractIdentifier("https://www.phonepe.com/careers/job-openings/")).toBeNull();
  });

  it("maps a PhonePe-shaped posting and uses the 128-second request timeout", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ totalFound: 1, content: [listing("1001")] }))
      .mockResolvedValueOnce(jsonResponse(detail("1001")));

    const result = await scraperWithFetch(fetchMock).scrape(SOURCE_URL);

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
      detectedBoardToken: "PHONEPELIMITED",
    });
    expect(result.openExternalIds).toEqual([
      "smartrecruiters-PHONEPELIMITED-1001",
    ]);
    expect(result.jobs[0]).toMatchObject({
      externalId: "smartrecruiters-PHONEPELIMITED-1001",
      title: "Engineering Manager, Backend",
      url: "https://jobs.smartrecruiters.com/PHONEPELIMITED/1001-engineering-manager-backend",
      location: "Pune, Maharashtra, India",
      locationType: "onsite",
      department: "Business Technology",
      employmentType: "full-time",
      seniorityLevel: "senior",
      descriptionFormat: "markdown",
      postedDate: new Date("2026-08-28T11:18:19.724Z"),
    });
    expect(result.jobs[0]?.description).toContain("Company Description");
    expect(result.jobs[0]?.description).toContain("Build backend systems.");
    expect(result.jobs[0]?.description).toContain("Qualifications");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ timeout: 128_000 });
  });

  it("uses a manual identifier for branded careers pages", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ totalFound: 0, content: [] })
    );

    const result = await scraperWithFetch(fetchMock).scrape(
      "https://www.phonepe.com/careers/job-openings/",
      { boardToken: "PHONEPELIMITED" }
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 0,
      listingCompleteness: "complete",
    });
    expect(result.detectedBoardToken).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/PHONEPELIMITED/postings?");
  });

  it("paginates until the unique count matches totalFound", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ totalFound: 3, content: [listing("1"), listing("2")] }))
      .mockResolvedValueOnce(jsonResponse({ totalFound: 3, content: [listing("3")] }));
    const result = await scraperWithFetch(fetchMock, { listingPageSize: 2 }).scrape(
      SOURCE_URL,
      {
        existingExternalIds: new Set([
          "smartrecruiters-PHONEPELIMITED-1",
          "smartrecruiters-PHONEPELIMITED-2",
          "smartrecruiters-PHONEPELIMITED-3",
        ]),
      }
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 3,
      listingCompleteness: "complete",
      jobs: [],
    });
    expect(result.openExternalIds).toEqual([
      "smartrecruiters-PHONEPELIMITED-1",
      "smartrecruiters-PHONEPELIMITED-2",
      "smartrecruiters-PHONEPELIMITED-3",
    ]);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("offset=2");
  });

  it("returns a complete explicitly empty board", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ totalFound: 0, content: [] })
    );

    await expect(scraperWithFetch(fetchMock).scrape(SOURCE_URL)).resolves.toMatchObject({
      outcome: "success",
      jobs: [],
      totalListings: 0,
      openExternalIds: [],
      listingCompleteness: "complete",
    });
  });

  it("marks overlapping and short pagination partial", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ totalFound: 3, content: [listing("1"), listing("2")] }))
      .mockResolvedValueOnce(jsonResponse({ totalFound: 3, content: [listing("2")] }));
    const result = await scraperWithFetch(fetchMock, { listingPageSize: 2 }).scrape(
      SOURCE_URL,
      {
        existingExternalIds: new Set([
          "smartrecruiters-PHONEPELIMITED-1",
          "smartrecruiters-PHONEPELIMITED-2",
        ]),
      }
    );

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 2,
      listingCompleteness: "partial",
    });
    if (result.outcome !== "partial") throw new Error("Expected partial result");
    expect(result.issues?.map((issue) => issue.message).join(" ")).toContain("overlapping");
    expect(result.issues?.map((issue) => issue.message).join(" ")).toContain("short");
  });

  it("retains valid IDs while marking malformed listing items partial", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        totalFound: 2,
        content: [listing("valid"), { id: "invalid-without-name" }],
      })
    );
    const result = await scraperWithFetch(fetchMock).scrape(SOURCE_URL, {
      existingExternalIds: new Set(["smartrecruiters-PHONEPELIMITED-valid"]),
    });

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 1,
      jobs: [],
      listingCompleteness: "partial",
    });
    expect(result.openExternalIds).toEqual([
      "smartrecruiters-PHONEPELIMITED-valid",
    ]);
  });

  it.each([
    [404, "board_not_found"],
    [429, "rate_limited"],
  ])("classifies an initial %i listing response as %s", async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, status));

    await expect(scraperWithFetch(fetchMock).scrape(SOURCE_URL)).resolves.toMatchObject({
      outcome: "error",
      error: { code, statusCode: status },
      listingCompleteness: "unknown",
    });
  });

  it("retains earlier pages and marks a later page failure partial", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ totalFound: 2, content: [listing("1")] }))
      .mockRejectedValueOnce(new TypeError("network down"));
    const result = await scraperWithFetch(fetchMock, { listingPageSize: 1 }).scrape(
      SOURCE_URL,
      { existingExternalIds: new Set(["smartrecruiters-PHONEPELIMITED-1"]) }
    );

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 1,
      jobs: [],
      listingCompleteness: "partial",
    });
    expect(result.openExternalIds).toEqual([
      "smartrecruiters-PHONEPELIMITED-1",
    ]);
  });

  it("keeps every listing ID when filters and existing jobs skip hydration", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        totalFound: 3,
        content: [
          listing("existing", "Backend Engineer"),
          { ...listing("filtered", "Sales Manager"), location: { fullLocation: "London, UK" } },
          listing("accepted", "Platform Engineer"),
        ],
      })
    ).mockResolvedValueOnce(jsonResponse(detail("accepted")));

    const result = await scraperWithFetch(fetchMock).scrape(SOURCE_URL, {
      filters: { country: "India", titleKeywords: ["engineer"] },
      existingExternalIds: new Set(["smartrecruiters-PHONEPELIMITED-existing"]),
    });

    expect(result.openExternalIds).toEqual([
      "smartrecruiters-PHONEPELIMITED-existing",
      "smartrecruiters-PHONEPELIMITED-filtered",
      "smartrecruiters-PHONEPELIMITED-accepted",
    ]);
    expect(result.jobs).toHaveLength(1);
    expect(result.earlyFiltered).toMatchObject({ total: 1, country: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retains list data and returns partial when detail hydration fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ totalFound: 1, content: [listing("1001")] }))
      .mockResolvedValueOnce(jsonResponse({}, 404));
    const result = await scraperWithFetch(fetchMock).scrape(SOURCE_URL);

    expect(result).toMatchObject({
      outcome: "partial",
      totalListings: 1,
      listingCompleteness: "complete",
    });
    expect(result.jobs[0]).toMatchObject({
      externalId: "smartrecruiters-PHONEPELIMITED-1001",
      title: "Role 1001",
      url: "https://jobs.smartrecruiters.com/PHONEPELIMITED/1001",
    });
    expect(result.jobs[0]?.description).toBeUndefined();
  });
});
