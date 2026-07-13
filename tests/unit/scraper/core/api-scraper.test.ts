import { describe, expect, it, vi } from "vitest";

import {
  AbstractApiScraper,
  DEFAULT_API_CONFIG,
  SWITCHY_USER_AGENT,
} from "@/lib/scraper/core";
import type {
  ApiScraperConfig,
  ScraperResult,
} from "@/lib/scraper/core/types";
import type { HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

class TestApiScraper extends AbstractApiScraper<ApiScraperConfig> {
  readonly platform = "greenhouse" as const;

  validate(): boolean {
    return true;
  }

  extractIdentifier(): string {
    return "test";
  }

  async scrape(): Promise<ScraperResult> {
    return {
      outcome: "success",
      jobs: [],
      totalListings: 0,
      listingCompleteness: "complete",
      openExternalIds: [],
    };
  }

  raw(url: string, options?: HttpRequestOptions): Promise<Response> {
    return this.fetchResponse(url, options);
  }

  headers(
    accept: "json" | "html",
    overrides?: Record<string, string>
  ): Record<string, string> {
    return accept === "json"
      ? this.jsonRequestHeaders(overrides)
      : this.htmlRequestHeaders(overrides);
  }
}

describe("AbstractApiScraper", () => {
  it("returns the untouched response and applies scraper retry defaults", async () => {
    const response = new Response("payload", { status: 202 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    const scraper = new TestApiScraper(
      createHttpClientStub({ fetch: fetchMock }),
      {
        ...DEFAULT_API_CONFIG,
        baseUrl: "https://example.com",
        timeout: 111,
        retries: 2,
        baseDelay: 17,
      }
    );

    const result = await scraper.raw("https://example.com/jobs", {
      retries: 4,
      headers: { Accept: "text/plain" },
    });

    expect(result).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/jobs", {
      timeout: 111,
      retries: 4,
      baseDelay: 17,
      headers: { Accept: "text/plain" },
    });
  });

  it("centralizes standard API headers while allowing explicit overrides", () => {
    const scraper = new TestApiScraper(
      createHttpClientStub(),
      { ...DEFAULT_API_CONFIG, baseUrl: "https://example.com" }
    );

    expect(scraper.headers("json")).toEqual({
      Accept: "application/json",
      "User-Agent": SWITCHY_USER_AGENT,
    });
    expect(scraper.headers("html", { Accept: "text/html", Cookie: "a=b" })).toEqual({
      Accept: "text/html",
      "User-Agent": SWITCHY_USER_AGENT,
      Cookie: "a=b",
    });
  });
});
