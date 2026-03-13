import { describe, expect, it, vi } from "vitest";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { LeverScraper } from "@/lib/scraper/platforms/lever";

function createHttpClient(fetchMock: ReturnType<typeof vi.fn>): IHttpClient {
  return {
    fetch: fetchMock,
    get: vi.fn(),
    post: vi.fn(),
  };
}

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

    const scraper = new LeverScraper(createHttpClient(fetchMock));
    const result = await scraper.scrape("https://jobs.lever.co/jiostar");

    expect(result.success).toBe(true);
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

    const scraper = new LeverScraper(createHttpClient(fetchMock));
    const result = await scraper.scrape("https://jobs.lever.co/umbrella");

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.descriptionFormat).toBe("plain");
    expect(job.description).toContain("Plain description only.");
    expect(job.description).toContain("Additional details in plain text.");
  });
});
