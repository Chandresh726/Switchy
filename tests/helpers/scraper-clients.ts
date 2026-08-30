import { vi } from "vitest";

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
