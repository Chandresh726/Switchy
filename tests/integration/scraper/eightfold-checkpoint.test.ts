import { describe, expect, it, vi } from "vitest";

import { DrizzleScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state-store";
import { EightfoldScraper } from "@/lib/scraper/platforms/eightfold";
import { createHttpClientStub } from "@test/helpers/scraper-clients";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";
import { createEightfoldSearchResponse } from "@test/fixtures/platforms/eightfold";

vi.mock("@/lib/db", () => ({ db: {} }));
const sqlite = createSqliteTestHarness("switchy-eightfold-checkpoint-");

describe("durable Eightfold recovery", () => {
  it("reuses completed pages from SQLite after reconstructing the adapter and connection", async () => {
    const { database, path } = sqlite.createDatabase();
    let limited = false;
    const offsets: number[] = [];
    const http = createHttpClientStub({ fetch: vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("start"));
      offsets.push(offset);
      if (offset === 20 && !limited) {
        limited = true;
        return new Response("limited", { status: 429, headers: { "retry-after": "60" } });
      }
      return createEightfoldSearchResponse(Array.from({ length: 10 }, (_, index) => offset + index + 1), 30);
    }) });
    const browser = { bootstrap: async () => null, withBrowser: async <T,>(): Promise<T> => { throw new Error("unused"); }, close: async () => undefined };
    const options = { filters: { titleKeywords: ["__skip_details__"] } };
    const source = "https://nvidia.eightfold.ai/careers?location=India";
    const first = new EightfoldScraper(http, browser, { retries: 0, requestDelayMs: 0 }, undefined,
      new DrizzleScrapeFetchStateStore(database));
    expect(await first.scrape(source, options)).toMatchObject({ outcome: "error", error: { code: "rate_limited" } });
    const second = new EightfoldScraper(http, browser, { retries: 0, requestDelayMs: 0 }, undefined,
      new DrizzleScrapeFetchStateStore(sqlite.connect(path).database));
    expect(await second.scrape(source, options)).toMatchObject({ outcome: "partial", listingCompleteness: "partial", totalListings: 30 });
    expect(offsets).toEqual([0, 10, 20, 0, 20]);
  });
});
