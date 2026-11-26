import { describe, expect, it, vi } from "vitest";

import { LeverScraper } from "@/lib/scraper/platforms/lever";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

describe("LeverScraper", () => {
  it("builds full descriptions from lists and additional content", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/v0/postings/jiostar?mode=json")) {
        return new Response(
          JSON.stringify([
            {
              id: "019173d8-1402-4eac-bfb3-54ea362ad755",
              text: "Software Development Engineer II (Java)",
              hostedUrl: "https://jobs.lever.co/jiostar/019173d8-1402-4eac-bfb3-54ea362ad755",
              categories: {
                location: "Bengaluru",
                team: "Engineering",
                commitment: "Full Time",
              },
              descriptionPlain: "Job Summary: short summary only.",
              descriptionBody: "<div><strong>Job Summary:</strong> Full summary content.</div>",
              lists: [
                {
                  text: "Key Responsibilities",
                  content: "<li>Own systems</li><li>Scale platforms</li>",
                },
              ],
              additional: "<div><b>About Us</b></div><div>We build streaming tech.</div>",
              createdAt: 1710000000000,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("not found", { status: 404 });
    });

    const scraper = new LeverScraper(createHttpClientStub({ fetch: fetchMock }));
    const result = await scraper.scrape("https://jobs.lever.co/jiostar");

    expect(result.outcome).not.toBe("error");
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.descriptionFormat).toBe("markdown");
    expect(job.description).toContain("Job Summary");
    expect(job.description).toContain("Own systems");
    expect(job.description).toContain("About Us");
    expect(job.description).toContain("We build streaming tech.");
  });

  it("falls back to plain descriptions when html fields are missing", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/v0/postings/umbrella?mode=json")) {
        return new Response(
          JSON.stringify([
            {
              id: "plain-only-job",
              text: "Support Engineer",
              hostedUrl: "https://jobs.lever.co/umbrella/plain-only-job",
              categories: {
                location: "Remote",
              },
              descriptionPlain: "Plain description only.",
              additionalPlain: "Additional details in plain text.",
              createdAt: 1710000000000,
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("not found", { status: 404 });
    });

    const scraper = new LeverScraper(createHttpClientStub({ fetch: fetchMock }));
    const result = await scraper.scrape("https://jobs.lever.co/umbrella");

    expect(result.outcome).not.toBe("error");
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.descriptionFormat).toBe("plain");
    expect(job.description).toContain("Plain description only.");
    expect(job.description).toContain("Additional details in plain text.");
  });
  it("routes EU boards and preserves workplace and salary fields while salvaging valid records", async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => Response.json([
      { id: "one", text: "Engineer", hostedUrl: "https://jobs.eu.lever.co/acme/one", workplaceType: "remote",
        categories: { location: "Berlin", team: null }, salaryRange: { min: 100, max: 200, currency: "EUR", interval: "year" } },
      { id: "broken" },
    ]));
    const scraper = new LeverScraper(createHttpClientStub({ fetch }));
    const result = await scraper.scrape("https://jobs.eu.lever.co/acme");
    expect(scraper.extractIdentifier("https://jobs.eu.lever.co/acme")).toBe("acme");
    expect(fetch.mock.calls[0]?.[0]).toContain("https://api.eu.lever.co/v0/postings/acme");
    expect(result).toMatchObject({ outcome: "partial", listingCompleteness: "partial", jobs: [
      { locationType: "remote", salary: "100 - 200 EUR year" },
    ] });
  });

  it("paginates explicitly and treats repeated pages as incomplete", async () => {
    const record = { id: "one", text: "Engineer", hostedUrl: "https://jobs.lever.co/acme/one" };
    const fetch = vi.fn(async () => Response.json([record]));
    const scraper = new LeverScraper(createHttpClientStub({ fetch }), { listingPageSize: 1 });
    const result = await scraper.scrape("https://jobs.lever.co/acme");
    expect(result).toMatchObject({ outcome: "partial", listingCompleteness: "partial", totalListings: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves Retry-After for durable rate-limit recovery", async () => {
    const scraper = new LeverScraper(createHttpClientStub({ fetch: async () => new Response("limited", {
      status: 429, headers: { "Retry-After": "120" },
    }) }));
    await expect(scraper.scrape("https://jobs.lever.co/acme")).resolves.toMatchObject({
      outcome: "error", error: { code: "rate_limited", retryAfterMs: 120_000 },
    });
  });

});
