import { describe, expect, it, vi } from "vitest";

import type { ScrapeSessionStore } from "@/lib/scraper/infrastructure/types";
import {
  serializeFetchResult,
} from "@/lib/scraper/queue/fetch-result-persistence";
import type { ScrapeSessionProjectionStore } from "@/lib/scraper/queue/projection-store";
import { ScrapeSessionProjector } from "@/lib/scraper/application/scrape-session-projector";
import { createScrapeQueueItem } from "@test/fixtures/scraper/queue-items";

function createProjector() {
  let items = [
    createScrapeQueueItem({
      status: "queued",
      workerId: null,
      startedAt: null,
      lockedAt: null,
      leaseExpiresAt: null,
    }),
  ];
  const queueStore = {
    listSessionItems: vi.fn(async () => items),
  };
  const projectionStore: ScrapeSessionProjectionStore = {
    getSession: vi.fn(async () => ({
      triggerSource: "manual",
      status: "in_progress",
      startedAt: new Date(),
    })),
    listInProgressSessionIds: vi.fn(async () => []),
    getCommittedResult: vi.fn(async () => null),
    recoverCommittedQueueItems: vi.fn(async () => 0),
  };
  const sessionStore: ScrapeSessionStore = {
    stopSession: vi.fn(async () => true),
    updateSessionProgress: vi.fn(async () => undefined),
    completeSession: vi.fn(async () => undefined),
  };
  const projector = new ScrapeSessionProjector(
    queueStore,
    projectionStore,
    sessionStore,
    { getCompany: vi.fn(async () => null) }
  );
  return {
    projector,
    queueStore,
    sessionStore,
    setItems: (nextItems: typeof items) => {
      items = nextItems;
    },
  };
}

describe("ScrapeSessionProjector", () => {
  it("wakes an event-driven waiter after terminal projection", async () => {
    const { projector, sessionStore, setItems } = createProjector();
    const controller = new AbortController();
    const completion = projector.waitForTerminalItems(
      "session-1",
      controller.signal
    );
    await Promise.resolve();
    const completedAt = new Date();
    setItems([
      createScrapeQueueItem({
        status: "completed",
        resultJson: serializeFetchResult({
          companyId: 1,
          companyName: "Acme",
          success: true,
          outcome: "success",
          jobsFound: 4,
          jobsAdded: 2,
          jobsUpdated: 1,
          jobsFiltered: 0,
          jobsArchived: 0,
          platform: "greenhouse",
          duration: 10,
        }),
        completedAt,
      }),
    ]);

    await projector.reconcileSession("session-1");

    await expect(completion).resolves.toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
    expect(sessionStore.updateSessionProgress).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ companiesCompleted: 1, totalJobsAdded: 2 })
    );
    expect(sessionStore.completeSession).toHaveBeenCalledWith(
      "session-1",
      "completed"
    );
  });

  it("removes and rejects a cancelled waiter", async () => {
    const { projector, queueStore } = createProjector();
    const controller = new AbortController();
    const completion = projector.waitForTerminalItems(
      "session-1",
      controller.signal
    );
    await Promise.resolve();
    const reason = new Error("request stopped");

    controller.abort(reason);

    await expect(completion).rejects.toBe(reason);
    expect(queueStore.listSessionItems).toHaveBeenCalledTimes(1);
  });

  it("rechecks durable state after an out-of-band terminal update", async () => {
    vi.useFakeTimers();
    const { projector, setItems } = createProjector();
    const completion = projector.waitForTerminalItems(
      "session-1",
      new AbortController().signal
    );
    await Promise.resolve();
    setItems([
      createScrapeQueueItem({
        status: "failed",
        lastError: "failed elsewhere",
        completedAt: new Date(),
      }),
    ]);

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(completion).resolves.toEqual([
      expect.objectContaining({ status: "failed" }),
    ]);
  });

  it("reports queue work removed by an out-of-band cascade", async () => {
    vi.useFakeTimers();
    const { projector, setItems } = createProjector();
    const completion = projector.waitForTerminalItems(
      "session-1",
      new AbortController().signal
    );
    const rejection = expect(completion).rejects.toThrow(
      "Scrape queue work for session session-1 was removed."
    );
    await Promise.resolve();
    setItems([]);

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
  });

  it("closes a legacy in-progress session that has no durable queue items", async () => {
    const { projector, sessionStore, setItems } = createProjector();
    setItems([]);

    await projector.reconcileSession("session-1");

    expect(sessionStore.completeSession).toHaveBeenCalledWith(
      "session-1",
      "failed"
    );
  });
});
