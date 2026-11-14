import { afterEach, describe, expect, it, vi } from "vitest";

import { createDeviceWakeCheck, parseDeviceWakeState } from "@/lib/scraper/runtime/device-wake-state";

describe("device wake state", () => {
  afterEach(() => vi.useRealTimers());

  it("distinguishes full wake, DarkWake, and unavailable capability output", () => {
    expect(parseDeviceWakeState("Current System Capabilities are: CPU Graphics Audio Network \nCurrent Power State: 4")).toBe(true);
    expect(parseDeviceWakeState("Current System Capabilities are: CPU Network \nCurrent Power State: 2")).toBe(false);
    expect(parseDeviceWakeState("unknown output")).toBeNull();
  });

  it("shares concurrent probes and refreshes cached DarkWake results", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce("Current System Capabilities are: CPU Network")
      .mockResolvedValue("Current System Capabilities are: CPU Graphics Audio Network");
    const check = createDeviceWakeCheck("darwin", read);
    expect(await Promise.all([check(), check(), check()])).toEqual([false, false, false]);
    expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await check()).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not block other systems or permanently block scraping if the probe fails", async () => {
    const read = vi.fn().mockRejectedValue(new Error("unavailable"));
    expect(await createDeviceWakeCheck("linux", read)()).toBe(true);
    expect(read).not.toHaveBeenCalled();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await createDeviceWakeCheck("darwin", read)()).toBe(true);
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
