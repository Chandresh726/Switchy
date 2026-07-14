import { describe, expect, it, vi } from "vitest";

import { HistoryRetentionService } from "@/lib/scraper/application/history-retention-service";

describe("HistoryRetentionService", () => {
  it("prunes at most once per day using typed retention settings", async () => {
    let now = new Date("2026-07-13T00:00:00.000Z");
    const store = {
      prune: vi.fn(() => ({ deleted: 2, cutoff: new Date("2026-04-14") })),
    };
    const settings = {
      getFilters: vi.fn(),
      getMaxParallelScrapes: vi.fn(),
      getKeepDeviceAwake: vi.fn(async () => true),
      getHistoryRetentionDays: vi.fn(async () => 90),
    };
    const service = new HistoryRetentionService(store, settings, () => now);

    await expect(service.pruneIfDue()).resolves.toMatchObject({ deleted: 2 });
    await expect(service.pruneIfDue()).resolves.toBeNull();
    now = new Date("2026-07-14T00:00:00.000Z");
    await expect(service.pruneIfDue()).resolves.toMatchObject({ deleted: 2 });

    expect(store.prune).toHaveBeenNthCalledWith(1, 90, new Date("2026-07-13"));
    expect(store.prune).toHaveBeenCalledTimes(2);
  });

  it("isolates pruning failures so queue supervision can continue", async () => {
    const error = new Error("database busy");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = new HistoryRetentionService(
      { prune: vi.fn(() => { throw error; }) },
      {
        getFilters: vi.fn(),
        getMaxParallelScrapes: vi.fn(),
        getKeepDeviceAwake: vi.fn(async () => true),
        getHistoryRetentionDays: vi.fn(async () => 90),
      },
      () => new Date("2026-07-13T00:00:00.000Z")
    );

    await expect(service.pruneIfDue()).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "[HistoryRetentionService] Failed to prune scrape history:",
      error
    );
  });
});
