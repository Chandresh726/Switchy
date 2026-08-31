import { describe, expect, it, vi } from "vitest";

import { TalentBrewScraper } from "@/lib/scraper/platforms/talentbrew";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

function page(ids: string[], total = ids.length, pages = 1): string {
  return `
    <section data-total-results="${total}" data-total-pages="${pages}"
      data-ajax-url="/search-jobs/results" data-company-id="27595">
      <ul>${ids.map((id) => `
        <li class="job-result"><a href="/job/bengaluru/role-${id}/27595/${id}">
          <h2>Role ${id}</h2><span class="location">Bengaluru, India</span>
        </a></li>`).join("")}</ul>
    </section>`;
}

function detail(id: string): string {
  return `
    <main><h1>Role ${id}</h1>
      <div class="job-location">Bengaluru, India</div>
      <div class="job-category">Engineering</div>
      <div class="job-description"><h2>Overview</h2><p>Build product ${id}.</p></div>
    </main>`;
}

describe("TalentBrewScraper", () => {
  it("detects Intuit branded TalentBrew URLs and rejects spoofed hosts", () => {
    const scraper = new TalentBrewScraper(createHttpClientStub());
    expect(scraper.validate("https://jobs.intuit.com/search-jobs")).toBe(true);
    expect(scraper.validate("https://careers.intuit.com/")).toBe(true);
    expect(scraper.validate("https://jobs.intuit.com.example.com/search-jobs")).toBe(false);
    expect(scraper.extractIdentifier("https://jobs.intuit.com/search-jobs")).toBe("27595");
  });

  it("reads metadata, paginates, hydrates, and skips known jobs", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/job/")) {
        return new Response(detail(parsed.pathname.split("/").filter(Boolean).at(-1) ?? ""));
      }
      if (parsed.pathname.endsWith("/results")) {
        expect(parsed.searchParams.get("CurrentPage")).toBe("2");
        return Response.json({
          filters: "",
          results: page(["102"], 3, 2),
          hasJobs: true,
          hasContent: false,
        });
      }
      return new Response(page(["100", "101"], 3, 2));
    });
    const scraper = new TalentBrewScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });

    const result = await scraper.scrape("https://jobs.intuit.com/search-jobs", {
      existingExternalIds: new Set(["talentbrew-27595-100"]),
    });

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 3,
      listingCompleteness: "complete",
      detectedBoardToken: "27595",
      openExternalIds: [
        "talentbrew-27595-100",
        "talentbrew-27595-101",
        "talentbrew-27595-102",
      ],
    });
    expect(result.jobs.map((job) => job.externalId)).toEqual([
      "talentbrew-27595-101",
      "talentbrew-27595-102",
    ]);
    expect(result.jobs[0]).toMatchObject({
      department: "Engineering",
      descriptionFormat: "markdown",
    });
  });

  it("discovers the company identifier from canonical TalentBrew job URLs", async () => {
    const searchPage = page([], 1, 1).replace(' data-company-id="27595"', "");
    const scraper = new TalentBrewScraper(
      createHttpClientStub({
        fetch: vi.fn(async () =>
          new Response(
            searchPage.replace(
              "<ul></ul>",
              '<ul><li><a href="/job/bangalore/role/27595/123"><h2>Role 123</h2></a></li></ul>'
            )
          )
        ),
      })
    );

    const result = await scraper.scrape("https://jobs.intuit.com/search-jobs", {
      existingExternalIds: new Set(["talentbrew-27595-123"]),
    });
    expect(result).toMatchObject({
      outcome: "success",
      detectedBoardToken: "27595",
      openExternalIds: ["talentbrew-27595-123"],
    });
  });

  it("returns partial when an advertised page is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(page(["100"], 2, 2)))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const scraper = new TalentBrewScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });
    const result = await scraper.scrape("https://jobs.intuit.com/search-jobs", {
      existingExternalIds: new Set(["talentbrew-27595-100"]),
    });

    expect(result).toMatchObject({
      outcome: "partial",
      listingCompleteness: "partial",
      totalListings: 1,
    });
  });

  it("does not treat a metadata-free blank page as an advertised empty board", async () => {
    const scraper = new TalentBrewScraper(
      createHttpClientStub({
        fetch: vi.fn(async () => new Response("<html><body></body></html>")),
      })
    );

    await expect(
      scraper.scrape("https://jobs.intuit.com/search-jobs")
    ).resolves.toMatchObject({
      outcome: "error",
      error: { code: "parse_error" },
    });
  });

  it.each([
    [404, "board_not_found"],
    [429, "rate_limited"],
  ])("classifies an initial %i response as %s", async (status, code) => {
    const scraper = new TalentBrewScraper(
      createHttpClientStub({
        fetch: vi.fn(async () => new Response("error", { status })),
      })
    );
    await expect(scraper.scrape("https://jobs.intuit.com/search-jobs")).resolves.toMatchObject({
      outcome: "error",
      error: { code, statusCode: status },
    });
  });
});
