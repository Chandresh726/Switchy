import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueCancellationResult } from "@/lib/scraper/queue/types";

const store = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  assertAppRequest: vi.fn(),
  cancelSession:
    vi.fn<(sessionId: string) => Promise<QueueCancellationResult>>(),
  deleteScrapeHistory: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: store.assertAppRequest,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: store.select.mockImplementation(() => {
      const result = store.selectResults.shift() ?? [];
      const query = {
        from: () => query,
        leftJoin: () => query,
        where: () => query,
        limit: () => query,
        offset: () => query,
        orderBy: () => Promise.resolve(result),
        then: (
          resolve: (value: unknown[]) => unknown,
          reject?: (error: unknown) => unknown
        ) => Promise.resolve(result).then(resolve, reject),
      };
      return query;
    }),
  },
}));

vi.mock("@/lib/scraper", () => ({
  deleteScrapeHistory: store.deleteScrapeHistory,
  getLocalScrapeQueueService: () => ({
    cancelSession: store.cancelSession,
  }),
}));

import { DELETE, GET, PATCH } from "@/app/api/scrape-history/route";

function createRequest(method: "GET" | "PATCH" | "DELETE", query = ""): NextRequest {
  return new Request(`http://localhost/api/scrape-history${query}`, {
    method,
  }) as NextRequest;
}

describe("scrape history route", () => {
  beforeEach(() => {
    store.selectResults.length = 0;
    store.cancelSession.mockResolvedValue({
      cancelledQueued: 0,
      signalledRunning: 0,
      sessionStopped: false,
    });
    store.deleteScrapeHistory.mockReturnValue({ active: false, deleted: 1 });
  });

  it("returns session logs and durable queue metadata for a detail request", async () => {
    const session = { id: "session-1", status: "in_progress" };
    const log = { id: 1, companyName: "Acme", status: "success" };
    const queueItem = {
      id: "queue-1",
      companyId: 7,
      companyName: "Acme",
      status: "running",
      attemptCount: 2,
      maxAttempts: 3,
      leaseExpiresAt: new Date("2026-07-13T12:00:00.000Z"),
      lastError: "previous attempt failed",
    };
    store.selectResults.push([session], [log], [queueItem]);

    const response = await GET(createRequest("GET", "?sessionId=session-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session,
      logs: [log],
      queueItems: [
        {
          ...queueItem,
          leaseExpiresAt: "2026-07-13T12:00:00.000Z",
        },
      ],
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns 404 when a requested session does not exist", async () => {
    store.selectResults.push([]);

    const response = await GET(createRequest("GET", "?sessionId=missing"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Session not found" });
  });

  it("rejects deletion while durable work remains active", async () => {
    store.deleteScrapeHistory.mockReturnValue({ active: true, deleted: 0 });

    const response = await DELETE(
      createRequest("DELETE", "?sessionId=session-1")
    );

    expect(store.assertAppRequest).toHaveBeenCalledTimes(1);
    expect(store.deleteScrapeHistory).toHaveBeenCalledWith("session-1");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Stop the active scrape before deleting its history",
    });
  });

  it("deletes terminal history and reports the retained contract", async () => {
    store.deleteScrapeHistory.mockReturnValue({ active: false, deleted: 4 });

    const response = await DELETE(createRequest("DELETE"));

    expect(store.deleteScrapeHistory).toHaveBeenCalledWith(undefined);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, deleted: 4 });
  });

  it("requires a session ID before requesting cancellation", async () => {
    const response = await PATCH(createRequest("PATCH"));

    expect(response.status).toBe(400);
    expect(store.cancelSession).not.toHaveBeenCalled();
  });

  it("returns stopped when queue cancellation terminates the session", async () => {
    store.cancelSession.mockResolvedValue({
      cancelledQueued: 2,
      signalledRunning: 1,
      sessionStopped: true,
    });

    const response = await PATCH(
      createRequest("PATCH", "?sessionId=session-1")
    );

    expect(store.cancelSession).toHaveBeenCalledWith("session-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, stopped: true });
    expect(store.select).not.toHaveBeenCalled();
  });

  it("reports the current terminal status when no active work was stopped", async () => {
    store.selectResults.push([{ id: "session-1", status: "completed" }]);

    const response = await PATCH(
      createRequest("PATCH", "?sessionId=session-1")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      stopped: false,
      status: "completed",
    });
  });

  it("returns 404 when cancellation targets an unknown session", async () => {
    store.selectResults.push([]);

    const response = await PATCH(
      createRequest("PATCH", "?sessionId=missing")
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Session not found" });
  });
});
