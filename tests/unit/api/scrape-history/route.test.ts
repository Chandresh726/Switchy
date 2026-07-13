import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueueCancellationResult } from "@/lib/scraper/queue/types";

const store = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  cancelSession:
    vi.fn<(sessionId: string) => Promise<QueueCancellationResult>>(),
  deleteHistory: vi.fn(),
  getDetail: vi.fn(),
  getSessionStatus: vi.fn(),
  list: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: store.assertAppRequest,
}));

vi.mock("@/lib/scraper", () => ({
  getLocalScrapeQueueService: () => ({
    cancelSession: store.cancelSession,
  }),
}));

vi.mock("@/lib/scraper/history", () => ({
  getScrapeHistoryStore: () => ({
    delete: store.deleteHistory,
    getDetail: store.getDetail,
    getSessionStatus: store.getSessionStatus,
    list: store.list,
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
    vi.clearAllMocks();
    store.cancelSession.mockResolvedValue({
      cancelledQueued: 0,
      signalledRunning: 0,
      sessionStopped: false,
    });
    store.deleteHistory.mockReturnValue({ active: false, deleted: 1 });
    store.getDetail.mockReturnValue(null);
    store.getSessionStatus.mockReturnValue(null);
    store.list.mockReturnValue({
      sessions: [],
      pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
      stats: { totalSessions: 0, successRate: 0, avgDuration: 0 },
    });
  });

  it("maps list pagination through the history store", async () => {
    const page = {
      sessions: [{ id: "session-1", status: "completed" }],
      pagination: { total: 5, limit: 2, offset: 1, hasMore: true },
      stats: { totalSessions: 5, successRate: 80, avgDuration: 1200 },
    };
    store.list.mockReturnValue(page);

    const response = await GET(createRequest("GET", "?limit=2&offset=1"));

    expect(response.status).toBe(200);
    expect(store.list).toHaveBeenCalledWith({ limit: 2, offset: 1 });
    await expect(response.json()).resolves.toEqual(page);
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
    store.getDetail.mockReturnValue({ session, logs: [log], queueItems: [queueItem] });

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
    const response = await GET(createRequest("GET", "?sessionId=missing"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Session not found" });
  });

  it("rejects deletion while durable work remains active", async () => {
    store.deleteHistory.mockReturnValue({ active: true, deleted: 0 });

    const response = await DELETE(
      createRequest("DELETE", "?sessionId=session-1")
    );

    expect(store.assertAppRequest).toHaveBeenCalledTimes(1);
    expect(store.deleteHistory).toHaveBeenCalledWith("session-1");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Stop the active scrape before deleting its history",
    });
  });

  it("deletes terminal history and reports the retained contract", async () => {
    store.deleteHistory.mockReturnValue({ active: false, deleted: 4 });

    const response = await DELETE(createRequest("DELETE"));

    expect(store.deleteHistory).toHaveBeenCalledWith(undefined);
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
    expect(store.getSessionStatus).not.toHaveBeenCalled();
  });

  it("reports the current terminal status when no active work was stopped", async () => {
    store.getSessionStatus.mockReturnValue({ id: "session-1", status: "completed" });

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
    const response = await PATCH(
      createRequest("PATCH", "?sessionId=missing")
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Session not found" });
  });
});
