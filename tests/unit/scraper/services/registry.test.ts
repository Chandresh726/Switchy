import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { getActiveScrapeSignal } from "@/lib/scraper/infrastructure/cancellation";
import type { IScraper } from "@/lib/scraper/core/types";
import {
  createScraperRegistry,
  ScraperRegistry,
} from "@/lib/scraper/services/registry";

function createHttpClient(): IHttpClient {
  return {
    fetch: vi.fn() as IHttpClient["fetch"],
    get: vi.fn() as IHttpClient["get"],
    post: vi.fn() as IHttpClient["post"],
  };
}

function createBrowserClient(): IBrowserClient {
  return {
    bootstrap: vi.fn(async () => null),
    withBrowser: vi.fn(async () => {
      throw new Error("not used in this test");
    }),
    close: vi.fn(async () => undefined),
  };
}

describe("createScraperRegistry", () => {
  it("registers the supported reusable platform scrapers", () => {
    const registry = createScraperRegistry({
      httpClient: createHttpClient(),
      browserClient: createBrowserClient(),
    });

    expect(registry.getScraperByPlatform("servicenow")?.platform).toBe("servicenow");
    expect(registry.getScraperByPlatform("smartrecruiters")?.platform).toBe("smartrecruiters");
    expect(registry.getScraperByPlatform("turbohire")?.platform).toBe("turbohire");
    expect(registry.getScraperByPlatform("mynexthire")?.platform).toBe("mynexthire");
    expect(registry.getScraperByPlatform("visa")?.platform).toBe("visa");
  });

  it("publishes capability metadata used by local scheduling", () => {
    const registry = createScraperRegistry({
      httpClient: createHttpClient(),
      browserClient: createBrowserClient(),
    });

    expect(registry.getScraperByPlatform("greenhouse")?.capabilities).toEqual({
      transport: "http",
      concurrency: "parallel",
      supportsCancellation: true,
    });
    expect(registry.getScraperByPlatform("smartrecruiters")?.capabilities).toEqual({
      transport: "http",
      concurrency: "parallel",
      supportsCancellation: true,
    });
    expect(registry.getScraperByPlatform("servicenow")?.capabilities).toEqual({
      transport: "http",
      concurrency: "parallel",
      supportsCancellation: true,
    });
    expect(registry.getScraperByPlatform("eightfold")?.capabilities).toEqual({
      transport: "browser",
      concurrency: "browser_limited",
      supportsCancellation: true,
    });
    expect(registry.getScraperByPlatform("workday")?.capabilities).toEqual({
      transport: "browser",
      concurrency: "browser_limited",
      supportsCancellation: true,
    });
    expect(registry.getScraperByPlatform("uber")?.capabilities).toEqual({
      transport: "http",
      concurrency: "parallel",
      supportsCancellation: true,
    });
  });

  it("binds a scrape signal to the shared infrastructure context", async () => {
    let activeSignal: AbortSignal | undefined;
    const registry = new ScraperRegistry();
    registry.register({
      platform: "greenhouse",
      requiresBrowser: false,
      capabilities: {
        transport: "http",
        concurrency: "parallel",
        supportsCancellation: true,
      },
      validate: () => true,
      extractIdentifier: () => "test",
      scrape: async () => {
        activeSignal = getActiveScrapeSignal();
        return {
          outcome: "success",
          jobs: [],
          totalListings: 0,
          openExternalIds: [],
          listingCompleteness: "complete",
        };
      },
    } satisfies IScraper);
    const controller = new AbortController();

    await registry.scrape("https://example.com", "greenhouse", {
      signal: controller.signal,
    });

    expect(activeSignal).toBe(controller.signal);
  });
});
