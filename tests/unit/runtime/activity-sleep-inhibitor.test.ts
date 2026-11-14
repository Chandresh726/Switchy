import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivitySleepInhibitor, withSleepProtection } from "@/lib/runtime/activity-sleep-inhibitor";

vi.mock("@/lib/db", () => ({ db: {} }));

function createManager(enabled = true) {
  const release = vi.fn(async () => undefined);
  const acquire = vi.fn(async () => ({ release }));
  const read = vi.fn(async () => enabled);
  return { manager: new ActivitySleepInhibitor({ acquire }, read), acquire, release, read };
}

describe("activity sleep protection", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("holds one assertion until both scraping and matching finish", async () => {
    vi.useFakeTimers();
    const { manager, acquire, release } = createManager();
    const scrape = await manager.acquire();
    const match = await manager.acquire();
    expect(acquire).toHaveBeenCalledOnce();
    await scrape.release();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(release).not.toHaveBeenCalled();
    await match.release();
    await match.release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps the same assertion across adjacent tasks and releases it when idle", async () => {
    vi.useFakeTimers();
    const { manager, acquire, release } = createManager();
    const first = await manager.acquire();
    await first.release();
    await vi.advanceTimersByTimeAsync(500);
    const second = await manager.acquire();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(release).not.toHaveBeenCalled();
    expect(acquire).toHaveBeenCalledOnce();
    await second.release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(release).toHaveBeenCalledOnce();
  });

  it("applies the toggle immediately to running work without a scheduler", async () => {
    vi.useFakeTimers();
    const { manager, acquire, release, read } = createManager(false);
    const work = await manager.acquire();
    expect(acquire).not.toHaveBeenCalled();
    read.mockResolvedValue(true);
    await manager.refresh();
    expect(acquire).toHaveBeenCalledOnce();
    read.mockResolvedValue(false);
    await manager.refresh();
    expect(release).toHaveBeenCalledOnce();
    await work.release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not hold an assertion just because the setting is enabled", async () => {
    const { manager, acquire } = createManager();
    await manager.refresh();
    expect(acquire).not.toHaveBeenCalled();
  });

  it("releases protection on failure and preserves the original work error", async () => {
    const release = vi.fn(async () => { throw new Error("release failed"); });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure = new Error("work failed");
    await expect(withSleepProtection({ acquire: async () => ({ release }) }, async () => { throw failure; })).rejects.toBe(failure);
    expect(release).toHaveBeenCalledOnce();
  });
});
