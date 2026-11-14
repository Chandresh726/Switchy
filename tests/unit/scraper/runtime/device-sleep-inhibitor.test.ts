import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CaffeinateDeviceSleepInhibitor } from "@/lib/scraper/runtime/device-sleep-inhibitor";

function createChildProcess() {
  const child = new EventEmitter() as ChildProcess;
  Object.defineProperty(child, "killed", { configurable: true, value: false });
  Object.defineProperty(child, "exitCode", { configurable: true, value: null });
  child.unref = vi.fn();
  child.kill = vi.fn(() => {
    Object.defineProperty(child, "killed", { configurable: true, value: true });
    return true;
  });
  queueMicrotask(() => child.emit("spawn"));
  return child;
}

describe("CaffeinateDeviceSleepInhibitor", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("confirms one process-bound assertion and keeps it for long work without renewal gaps", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const child = createChildProcess();
    const spawn = vi.fn(() => child);
    const ready = Promise.withResolvers<boolean>();
    const confirm = vi.fn(() => ready.promise);
    let acquired = false;
    const acquisition = new CaffeinateDeviceSleepInhibitor("darwin", spawn, confirm)
      .acquire().then((lease) => { acquired = true; return lease; });
    await Promise.resolve();
    await Promise.resolve();
    expect(acquired).toBe(false);
    ready.resolve(true);
    const lease = await acquisition;
    expect(spawn).toHaveBeenCalledWith("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)]);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(spawn).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
    await lease.release();
    await lease.release();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it("restarts an unexpectedly exited helper and cancels restarts on release", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const children: ChildProcess[] = [];
    const spawn = vi.fn(() => { const child = createChildProcess(); children.push(child); return child; });
    const lease = await new CaffeinateDeviceSleepInhibitor("darwin", spawn, async () => true).acquire();
    children[0].emit("exit", 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    children[1].emit("exit", 1);
    await lease.release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("retries a launch whose OS assertion was not confirmed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const spawn = vi.fn(() => createChildProcess());
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const lease = await new CaffeinateDeviceSleepInhibitor("darwin", spawn, confirm).acquire();
    expect(spawn.mock.results[0].value.kill).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(confirm).toHaveBeenCalledTimes(2);
    await lease.release();
  });

  it("backs off repeated launch failures without failing work", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const spawn = vi.fn(() => { throw new Error("missing executable"); });
    const lease = await new CaffeinateDeviceSleepInhibitor("darwin", spawn).acquire();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(spawn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(spawn).toHaveBeenCalledTimes(3);
    await lease.release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it("ignores a stale confirmation after a replacement helper has started", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const children: ChildProcess[] = [];
    const spawn = vi.fn(() => { const child = createChildProcess(); children.push(child); return child; });
    const firstConfirmation = Promise.withResolvers<boolean>();
    const confirm = vi.fn().mockImplementationOnce(() => firstConfirmation.promise).mockResolvedValue(true);
    const acquisition = new CaffeinateDeviceSleepInhibitor("darwin", spawn, confirm).acquire();
    await Promise.resolve();
    await Promise.resolve();
    children[0].emit("exit", 1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    firstConfirmation.resolve(false);
    const lease = await acquisition;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(spawn).toHaveBeenCalledTimes(2);
    await lease.release();
    expect(children[1].kill).toHaveBeenCalledOnce();
  });

  it("does not spawn outside macOS", async () => {
    const spawn = vi.fn();
    const lease = await new CaffeinateDeviceSleepInhibitor("linux", spawn).acquire();
    await lease.release();
    expect(spawn).not.toHaveBeenCalled();
  });
});
