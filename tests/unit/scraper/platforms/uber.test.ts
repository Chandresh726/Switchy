import { describe, expect, it, vi } from "vitest";

import { UberScraper } from "@/lib/scraper/platforms/uber";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

function createListingPage(
  jobs: Array<{ id: number; title: string; location: string; team: string }>,
  totalPages = 1
): string {
  return `<!doctype html><html><body><main>${jobs
    .map(
      (job) => `<div data-slot="card" data-id="${job.id}">
        <a class="js-view-job" href="/en/jobs/${job.id}/">${job.title}</a>
        <div data-slot="card-description"><div>
          <div><svg></svg><div>${job.location}</div></div>
          <div><svg></svg>${job.team}</div>
        </div></div>
      </div>`
    )
    .join("")}${Array.from(
      { length: totalPages },
      (_value, index) =>
        `<a href="/en/jobs?page=${index + 1}&pagesize=10">${index + 1}</a>`
    ).join("")}</main></body></html>`;
}

function createDetailPage(id: number): string {
  return `<!doctype html><html><body><main>
    <h1>Role ${id}</h1><div>Posted on Aug 25, 2026</div>
    <h2>About the role and team</h2><p>Build dependable systems.</p>
    <h2>What you'll do</h2><ul><li>Ship reliable software.</li></ul>
  </main></body></html>`;
}

describe("UberScraper", () => {
  it("paginates the current server-rendered careers site and hydrates details", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (/\/en\/jobs\/\d+\/$/.test(parsed.pathname)) {
        return new Response(createDetailPage(Number(parsed.pathname.split("/")[3])));
      }
      const page = Number(parsed.searchParams.get("page") ?? 1);
      return new Response(
        createListingPage(
          [
            {
              id: page,
              title: `Role ${page}`,
              location: "Bengaluru, Karnataka",
              team: "Engineering",
            },
          ],
          2
        )
      );
    });
    const scraper = new UberScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });

    const result = await scraper.scrape(
      "https://www.uber.com/in/en/careers/list/"
    );

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 2,
      listingCompleteness: "complete",
      openExternalIds: ["uber-1", "uber-2"],
    });
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({
      externalId: "uber-1",
      location: "Bengaluru, Karnataka",
      department: "Engineering",
      descriptionFormat: "markdown",
    });
  });

  it("hydrates only new jobs while retaining all authoritative open IDs", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (/\/en\/jobs\/2\/$/.test(parsed.pathname)) {
        return new Response(createDetailPage(2));
      }
      return new Response(
        createListingPage([
          { id: 1, title: "Existing", location: "Pune", team: "Data" },
          { id: 2, title: "New", location: "Pune", team: "Data" },
        ])
      );
    });
    const scraper = new UberScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });

    const result = await scraper.scrape("https://jobs.uber.com/en/jobs/", {
      existingExternalIds: new Set(["uber-1"]),
    });

    expect(result.openExternalIds).toEqual(["uber-1", "uber-2"]);
    expect(result.jobs.map((job) => job.externalId)).toEqual(["uber-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a retryable error for a verification page", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("<html><title>Just a moment...</title></html>")
    );
    const scraper = new UberScraper(createHttpClientStub({ fetch: fetchMock }));

    const result = await scraper.scrape("https://jobs.uber.com/en/jobs/");

    expect(result).toMatchObject({
      outcome: "error",
      error: { code: "network_error", retryable: true },
    });
  });

  it("retains listing data and reports partial when a detail page is blocked", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      /\/en\/jobs\/1\/$/.test(new URL(url).pathname)
        ? new Response("blocked", { status: 403 })
        : new Response(
            createListingPage([
              {
                id: 1,
                title: "Engineer",
                location: "Remote",
                team: "Engineering",
              },
            ])
          )
    );
    const scraper = new UberScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
    });

    const result = await scraper.scrape("https://jobs.uber.com/en/jobs/");

    expect(result).toMatchObject({
      outcome: "partial",
      listingCompleteness: "complete",
    });
    expect(result.jobs).toHaveLength(1);
  });
});
