import { describe, expect, it } from "vitest";

import { KeyedExecutionLock } from "@/lib/scraper/runtime/keyed-lock";
import { SharedExclusiveExecutionGate } from "@/lib/scraper/runtime/shared-exclusive-gate";

describe("SharedExclusiveExecutionGate", () => {
  it("honors shared capacity and gives queued exclusive work a barrier", async () => {
    const gate = new SharedExclusiveExecutionGate(2);
    const signal = new AbortController().signal;
    const releaseFirst = await gate.acquire("shared", signal);
    const releaseSecond = await gate.acquire("shared", signal);
    let exclusiveStarted = false;
    const exclusive = gate.acquire("exclusive", signal).then((release) => {
      exclusiveStarted = true;
      return release;
    });
    let trailingSharedStarted = false;
    const trailingShared = gate.acquire("shared", signal).then((release) => {
      trailingSharedStarted = true;
      return release;
    });

    releaseFirst();
    await Promise.resolve();
    expect(exclusiveStarted).toBe(false);
    expect(trailingSharedStarted).toBe(false);
    releaseSecond();
    const releaseExclusive = await exclusive;
    expect(exclusiveStarted).toBe(true);
    expect(trailingSharedStarted).toBe(false);
    releaseExclusive();
    const releaseTrailing = await trailingShared;
    expect(trailingSharedStarted).toBe(true);
    releaseTrailing();
  });

  it("removes an aborted waiter without blocking later work", async () => {
    const gate = new SharedExclusiveExecutionGate(1);
    const activeController = new AbortController();
    const releaseActive = await gate.acquire("shared", activeController.signal);
    const cancelledController = new AbortController();
    const cancelled = gate.acquire("exclusive", cancelledController.signal);
    cancelledController.abort(new Error("cancelled"));
    await expect(cancelled).rejects.toMatchObject({ message: "cancelled" });

    const next = gate.acquire("shared", new AbortController().signal);
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
