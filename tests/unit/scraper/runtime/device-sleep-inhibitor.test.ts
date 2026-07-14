import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CaffeinateDeviceSleepInhibitor } from "@/lib/scraper/runtime/device-sleep-inhibitor";

function createChildProcess() {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperty(child, "killed", { configurable: true, value: false });
  child.unref = vi.fn();
  child.kill = vi.fn(() => {
    Object.defineProperty(child, "killed", { configurable: true, value: true });
    return true;
  });
  return child;
}

describe("CaffeinateDeviceSleepInhibitor", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts, renews, and idempotently releases bounded macOS assertions", async () => {
    vi.useFakeTimers();
    const first = createChildProcess();
    const second = createChildProcess();
    const spawnProcess = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const inhibitor = new CaffeinateDeviceSleepInhibitor(
      "darwin",
      spawnProcess
    );

    const lease = await inhibitor.acquire();
    expect(spawnProcess).toHaveBeenCalledWith("/usr/bin/caffeinate", [
      "-i",
      "-t",
      "300",
    ]);

    await vi.advanceTimersByTimeAsync(240_000);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(first.kill).toHaveBeenCalledTimes(1);

    await lease.release();
    await lease.release();
    expect(second.kill).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(240_000);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it("does not spawn a process outside macOS", async () => {
    const spawnProcess = vi.fn();
    const inhibitor = new CaffeinateDeviceSleepInhibitor(
      "linux",
      spawnProcess
    );

    const lease = await inhibitor.acquire();
    await lease.release();

    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps acquisition non-fatal when caffeinate cannot launch", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inhibitor = new CaffeinateDeviceSleepInhibitor("darwin", () => {
      throw new Error("missing executable");
    });

    const lease = await inhibitor.acquire();
    await lease.release();

    expect(console.warn).toHaveBeenCalledWith(
      "[DeviceSleepInhibitor] Failed to start caffeinate assertion:",
      expect.any(Error)
    );
  });
});
