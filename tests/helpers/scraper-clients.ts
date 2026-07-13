import type { Page } from "playwright";
import { vi } from "vitest";

import type { IBrowserClient } from "@/lib/scraper/infrastructure/browser-client";
import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";

export function createHttpClientStub(
  overrides: Partial<IHttpClient> = {}
): IHttpClient {
  return {
    fetch: vi.fn() as IHttpClient["fetch"],
    get: vi.fn() as IHttpClient["get"],
    post: vi.fn() as IHttpClient["post"],
    ...overrides,
  };
}

export function createBrowserClientStub(
  overrides: Partial<IBrowserClient> = {}
): IBrowserClient {
  return {
    bootstrap: vi.fn(async () => null),
    withBrowser: vi.fn(
      async (callback: (page: Page) => Promise<unknown>) =>
        callback({} as Page)
    ) as IBrowserClient["withBrowser"],
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}
