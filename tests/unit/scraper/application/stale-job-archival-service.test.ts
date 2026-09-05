import { describe, expect, it, vi } from "vitest";

import { StaleJobArchivalService } from "@/lib/scraper/application/stale-job-archival-service";

describe("StaleJobArchivalService", () => {
  it("archives with a 60-day cutoff and throttles to once per day", async () => {
    let now = new Date("2026-07-13T00:00:00.000Z");
    const store = { archiveStaleJobs: vi.fn(async () => 3) };
    const settings = { getStaleJobArchiveDays: vi.fn(async () => 60) };
    const service = new StaleJobArchivalService(store, settings, () => now);

    await expect(service.archiveIfDue()).resolves.toMatchObject({
      archived: 3,
      days: 60,
    });
    await expect(service.archiveIfDue()).resolves.toBeNull();

    now = new Date("2026-07-14T00:00:00.000Z");
    await expect(service.archiveIfDue()).resolves.toMatchObject({
      archived: 3,
    });

    expect(store.archiveStaleJobs).toHaveBeenCalledTimes(2);
    expect(store.archiveStaleJobs).toHaveBeenNthCalledWith(
      1,
      new Date("2026-05-14T00:00:00.000Z"),
      new Date("2026-07-13T00:00:00.000Z")
    );
  });

  it("skips when the threshold is disabled", async () => {
    const store = { archiveStaleJobs: vi.fn(async () => 1) };
    const service = new StaleJobArchivalService(
      store,
      { getStaleJobArchiveDays: vi.fn(async () => 0) },
      () => new Date("2026-07-13T00:00:00.000Z")
    );

    await expect(service.archiveIfDue()).resolves.toBeNull();
    expect(store.archiveStaleJobs).not.toHaveBeenCalled();
  });

  it("isolates archival failures so queue supervision can continue", async () => {
    const error = new Error("database busy");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const service = new StaleJobArchivalService(
      {
        archiveStaleJobs: vi.fn(() => {
          throw error;
        }),
      },
      { getStaleJobArchiveDays: vi.fn(async () => 60) },
      () => new Date("2026-07-13T00:00:00.000Z")
    );

    await expect(service.archiveIfDue()).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      "[StaleJobArchivalService] Failed to archive stale jobs:",
      error
    );
  });
});
