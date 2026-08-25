import { describe, expect, it } from "vitest";

import { KeyedExecutionLock } from "@/lib/scraper/runtime/keyed-lock";
import { ScrapeResourceExecutionGate } from "@/lib/scraper/runtime/resource-execution-gate";

describe("ScrapeResourceExecutionGate", () => {
  it("limits browser-heavy work while allowing standard work to use free capacity", async () => {
    const gate = new ScrapeResourceExecutionGate(3, 1);
    const signal = new AbortController().signal;
    const releaseBrowser = await gate.acquire("browser_heavy", signal);
    let secondBrowserStarted = false;
    const secondBrowser = gate.acquire("browser_heavy", signal).then((release) => {
      secondBrowserStarted = true;
      return release;
    });
    let standardStarted = false;
    const standard = gate.acquire("standard", signal).then((release) => {
      standardStarted = true;
      return release;
    });

    await Promise.resolve();
    expect(secondBrowserStarted).toBe(false);
    expect(standardStarted).toBe(true);
    const releaseStandard = await standard;
    releaseStandard();
    releaseBrowser();
    const releaseSecondBrowser = await secondBrowser;
    expect(secondBrowserStarted).toBe(true);
    releaseSecondBrowser();
  });

  it("removes an aborted waiter without blocking later work", async () => {
    const gate = new ScrapeResourceExecutionGate(1, 1);
    const activeController = new AbortController();
    const releaseActive = await gate.acquire("browser_heavy", activeController.signal);
    const cancelledController = new AbortController();
    const cancelled = gate.acquire("browser_heavy", cancelledController.signal);
    cancelledController.abort(new Error("cancelled"));
    await expect(cancelled).rejects.toMatchObject({ message: "cancelled" });

    const next = gate.acquire("standard", new AbortController().signal);
    releaseActive();
    const releaseNext = await next;
    releaseNext();
  });
});

describe("KeyedExecutionLock", () => {
  it("serializes the same key while allowing unrelated keys", async () => {
    const lock = new KeyedExecutionLock<number>();
    const signal = new AbortController().signal;
    const releaseCompanyOne = await lock.acquire(1, signal);
    const queuedCompanyOne = lock.acquire(1, signal);
    const releaseCompanyTwo = await lock.acquire(2, signal);
    let secondCompanyOneStarted = false;
    void queuedCompanyOne.then(() => {
      secondCompanyOneStarted = true;
    });

    await Promise.resolve();
    expect(secondCompanyOneStarted).toBe(false);
    releaseCompanyTwo();
    releaseCompanyOne();
    const releaseSecondCompanyOne = await queuedCompanyOne;
    expect(secondCompanyOneStarted).toBe(true);
    releaseSecondCompanyOne();
  });

  it("drops a cancelled same-key waiter and grants the next one", async () => {
    const lock = new KeyedExecutionLock<string>();
    const releaseActive = await lock.acquire("acme", new AbortController().signal);
    const cancelledController = new AbortController();
    const cancelled = lock.acquire("acme", cancelledController.signal);
    const next = lock.acquire("acme", new AbortController().signal);

    cancelledController.abort(new Error("stopped"));
    await expect(cancelled).rejects.toMatchObject({ message: "stopped" });
    releaseActive();
    const releaseNext = await next;
    releaseNext();
  });
});
