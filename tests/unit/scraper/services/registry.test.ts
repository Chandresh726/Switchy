import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import { getActiveScrapeSignal } from "@/lib/scraper/infrastructure/cancellation";
import type { IScraper } from "@/lib/scraper/core/types";
import { PLATFORMS } from "@/lib/scraper/types/platform";
import { createHttpClientStub } from "@test/helpers/scraper-clients";
import {
  createScraperRegistry,
  ScraperRegistry,
} from "@/lib/scraper/services/registry";

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
  it("registers every supported scraper with its scheduling capabilities", () => {
    const registry = createScraperRegistry({
      httpClient: createHttpClientStub(),
      browserClient: createBrowserClient(),
    });

    for (const platform of PLATFORMS) {
      expect(registry.getScraperByPlatform(platform), platform).toMatchObject({
        platform,
        capabilities: {
          concurrency: "parallel",
        },
      });
    }
  });

  it("binds a scrape signal to the shared infrastructure context", async () => {
    let activeSignal: AbortSignal | undefined;
    const registry = new ScraperRegistry();
    registry.register({
      platform: "greenhouse",
      capabilities: {
        concurrency: "parallel",
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
