import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}), { virtual: true });

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { createScraperRegistry } from "@/lib/scraper/services/registry";

function createHttpClient(): IHttpClient {
  return {
    fetch: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
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
  it("registers the new ServiceNow, Zwayam, MynextHire, and Visa scrapers", () => {
    const registry = createScraperRegistry({
      httpClient: createHttpClient(),
      browserClient: createBrowserClient(),
    });

    expect(registry.getScraperByPlatform("servicenow")?.platform).toBe("servicenow");
    expect(registry.getScraperByPlatform("zwayam")?.platform).toBe("zwayam");
    expect(registry.getScraperByPlatform("mynexthire")?.platform).toBe("mynexthire");
    expect(registry.getScraperByPlatform("visa")?.platform).toBe("visa");
  });
});
