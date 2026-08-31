import { describe, expect, it, vi } from "vitest";

import { JobviteScraper } from "@/lib/scraper/platforms/jobvite";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

function listingPage(page: number): string {
  const job = page === 1
    ? ["opaque-one", "Engineer One", "Bangalore, India"]
    : ["opaque-two", "Engineer Two", "Pune, India"];
  return `
    <html><body>
      <table class="jv-job-list"><tr>
        <td><a href="/acme/job/${job[0]}">${job[1]}</a></td>
        <td class="jv-job-list-location">${job[2]}</td>
      </tr></table>
      <a href="/acme/search/?p=1">1</a>
      <a href="/acme/search/?p=2">2</a>
    </body></html>`;
}

function detailPage(id: string): string {
  const number = id === "opaque-one" ? "1001" : "1002";
  const location = id === "opaque-one" ? "Bangalore, India" : "Pune, India";
  return `
    <html><body><main>
      <h1>Engineer ${number}</h1>
      <div class="jv-job-detail-location">${location}</div>
      <div>Category: Engineering Job Type: Full Time Req.Num.: ${number}</div>
      <div class="jv-job-detail-description"><h2>About</h2><p>Build systems ${number}.</p></div>
    </main></body></html>`;
}

describe("JobviteScraper", () => {
  it("accepts canonical and Nutanix URLs without accepting spoofed hosts", () => {
    const scraper = new JobviteScraper(createHttpClientStub());
    expect(scraper.validate("https://jobs.jobvite.com/acme/jobs")).toBe(true);
    expect(scraper.validate("https://careers.nutanix.com/en/jobs/")).toBe(true);
    expect(scraper.validate("https://jobs.jobvite.com.example.com/acme/jobs")).toBe(false);
    expect(scraper.extractIdentifier("https://jobs.jobvite.com/Acme/jobs")).toBe("Acme");
    expect(scraper.extractIdentifier("https://careers.nutanix.com/en/jobs/")).toBe("nutanix");
  });

  it("paginates, hydrates numeric requisitions, and applies early filters", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes("/job/")) {
        return new Response(detailPage(parsed.pathname.split("/").filter(Boolean).at(-1) ?? ""));
      }
      return new Response(listingPage(Number(parsed.searchParams.get("p"))));
    });
    const scraper = new JobviteScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
      unavailableRetryDelayMs: 0,
    });

    const result = await scraper.scrape("https://jobs.jobvite.com/acme/jobs", {
      filters: { city: "Bangalore" },
    });

    expect(result).toMatchObject({
      outcome: "success",
      totalListings: 2,
      listingCompleteness: "complete",
      detectedBoardToken: "acme",
      earlyFiltered: { total: 1, city: 1 },
    });
    expect(new Set(result.openExternalIds)).toEqual(
      new Set(["jobvite-acme-1001", "jobvite-acme-1002"])
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      externalId: "jobvite-acme-1001",
      title: "Engineer 1001",
      location: "Bangalore, India",
      descriptionFormat: "markdown",
    });
    expect(result.jobs[0]?.description).toContain("Build systems 1001");
  });

  it("classifies a repeated Jobvite unavailable page as retryable", async () => {
    const fetchMock = vi.fn(async () =>
      new Response('<a href="/careers/info/unavailable.html">Career site is currently unavailable</a>')
    );
    const scraper = new JobviteScraper(createHttpClientStub({ fetch: fetchMock }), {
      unavailableRetries: 1,
      unavailableRetryDelayMs: 0,
    });

    await expect(scraper.scrape("https://jobs.jobvite.com/acme/jobs")).resolves.toMatchObject({
      outcome: "error",
      error: { code: "network_error", retryable: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not amplify shared HTTP network retries", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    const scraper = new JobviteScraper(createHttpClientStub({ fetch: fetchMock }), {
      unavailableRetries: 2,
      unavailableRetryDelayMs: 0,
    });

    await expect(scraper.scrape("https://jobs.jobvite.com/acme/jobs")).resolves.toMatchObject({
      outcome: "error",
      error: { code: "network_error", retryable: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not treat a silent blank Jobvite response as a complete empty board", async () => {
    const fetchMock = vi.fn(async () => new Response("<html><body></body></html>"));
    const scraper = new JobviteScraper(createHttpClientStub({ fetch: fetchMock }), {
      unavailableRetries: 1,
      unavailableRetryDelayMs: 0,
    });

    await expect(scraper.scrape("https://jobs.jobvite.com/acme/jobs")).resolves.toMatchObject({
      outcome: "error",
      error: { code: "network_error", retryable: true },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts an explicitly advertised zero-job board as complete", async () => {
    const scraper = new JobviteScraper(
      createHttpClientStub({
        fetch: vi.fn(async () =>
          new Response('<div class="jv-page-message">No open positions at this time.</div>')
        ),
      }),
      { unavailableRetryDelayMs: 0 }
    );

    await expect(scraper.scrape("https://jobs.jobvite.com/acme/jobs")).resolves.toMatchObject({
      outcome: "success",
      totalListings: 0,
      listingCompleteness: "complete",
      openExternalIds: [],
    });
  });

  it("uses the opaque Jobvite ID when a board does not publish Req.Num.", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/job/")) {
        return new Response(`
          <h1 class="jv-logo">Acme Careers</h1><h2 class="jv-header">Designer</h2>
          <div class="jv-job-detail-description"><p>Design customer workflows.</p></div>
        `);
      }
      return new Response(`
        <table><tr><td><a href="/acme/job/opaque-only">Designer</a></td></tr></table>
      `);
    });
    const scraper = new JobviteScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
      unavailableRetryDelayMs: 0,
    });

    const result = await scraper.scrape("https://jobs.jobvite.com/acme/jobs");
    expect(result).toMatchObject({
      outcome: "success",
      listingCompleteness: "complete",
      openExternalIds: ["jobvite-acme-opaque-only"],
      jobs: [{ title: "Designer", externalId: "jobvite-acme-opaque-only" }],
    });
  });

  it("returns partial and non-complete listings when a required detail fails", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/job/")
        ? new Response("blocked", { status: 403 })
        : new Response(listingPage(1).replace("<a href=\"/acme/search/?p=2\">2</a>", ""))
    );
    const scraper = new JobviteScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
      unavailableRetryDelayMs: 0,
    });
    const result = await scraper.scrape("https://jobs.jobvite.com/acme/jobs");

    expect(result).toMatchObject({
      outcome: "partial",
      listingCompleteness: "partial",
      openExternalIds: [],
      jobs: [],
    });
  });

  it("returns partial when a malformed listing is discarded", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/job/")
        ? new Response(detailPage("opaque-one"))
        : new Response(`
            <a href="/acme/job/opaque-one">Engineer One</a>
            <a href="/acme/job/malformed"></a>
          `)
    );
    const scraper = new JobviteScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
      unavailableRetryDelayMs: 0,
    });

    await expect(scraper.scrape("https://jobs.jobvite.com/acme/jobs")).resolves.toMatchObject({
      outcome: "partial",
      totalListings: 1,
      listingCompleteness: "partial",
    });
  });

  it("does not classify duplicate links for the same job as malformed", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/job/")
        ? new Response(detailPage("opaque-one"))
        : new Response(`
            <a href="/acme/job/opaque-one">Engineer One</a>
            <a href="/acme/job/opaque-one">Engineer One</a>
          `)
    );
    const scraper = new JobviteScraper(createHttpClientStub({ fetch: fetchMock }), {
      detailDelayMs: 0,
      unavailableRetryDelayMs: 0,
    });

    await expect(scraper.scrape("https://jobs.jobvite.com/acme/jobs")).resolves.toMatchObject({
      outcome: "success",
      totalListings: 1,
      listingCompleteness: "complete",
    });
  });
});
