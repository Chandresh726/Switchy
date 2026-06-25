import { describe, expect, it, vi } from "vitest";

import type { IHttpClient, HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import { GreenhouseScraper } from "@/lib/scraper/platforms/greenhouse";

type FetchMock = ReturnType<typeof vi.fn<(url: string, options?: HttpRequestOptions) => Promise<Response>>>;

function createHttpClient(fetchMock: FetchMock): IHttpClient {
  return {
    fetch: fetchMock,
    get: vi.fn() as IHttpClient["get"],
    post: vi.fn() as IHttpClient["post"],
  };
}

describe("GreenhouseScraper", () => {
  it("extracts board token from regional job-boards URLs", () => {
    const fetchMock = vi.fn();
    const scraper = new GreenhouseScraper(createHttpClient(fetchMock));

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

    const scraper = new GreenhouseScraper(createHttpClient(fetchMock));
    const result = await scraper.scrape("https://job-boards.eu.greenhouse.io/groww");

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/v1/boards/groww/jobs?content=true"),
      expect.any(Object)
    );
  });
});
