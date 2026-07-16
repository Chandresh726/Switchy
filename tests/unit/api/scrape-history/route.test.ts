import { NextRequest } from "next/server";

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

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
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

import { DELETE, GET as getDetail } from "@/app/api/scrape-history/[id]/route";
import { POST as cancel } from "@/app/api/scrape-history/[id]/cancel/route";
import { POST as clear } from "@/app/api/maintenance/scrape-history/clear/route";
import { GET } from "@/app/api/scrape-history/route";

function createRequest(method: "GET" | "POST" | "DELETE", path = ""): NextRequest {
  return new NextRequest(`http://localhost/api/scrape-history${path}`, {
    method,
  });
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
    const logPagination = { total: 1, limit: 50, offset: 0, hasMore: false };
    const workPagination = { total: 1, limit: 50, offset: 0, hasMore: false };
    store.getDetail.mockReturnValue({ session, logs: [log], logPagination, workPagination, hasActiveWork: true, queueItems: [queueItem] });

    const response = await getDetail(createRequest("GET", "/session-1"), { params: Promise.resolve({ id: "session-1" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session,
      logs: [log],
      logPagination,
      workPagination,
      hasActiveWork: true,
      queueItems: [
        {
          ...queueItem,
          leaseExpiresAt: "2026-07-13T12:00:00.000Z",
        },
      ],
    });
    expect(store.getDetail).toHaveBeenCalledWith(
      "session-1",
      { limit: 50, offset: 0 },
      { limit: 50, offset: 0 }
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns 404 when a requested session does not exist", async () => {
    const response = await getDetail(createRequest("GET", "/missing"), { params: Promise.resolve({ id: "missing" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Session not found",
      code: "scrape_session_not_found",
    });
  });

  it("rejects deletion while durable work remains active", async () => {
    store.deleteHistory.mockReturnValue({ active: true, deleted: 0 });

    const response = await DELETE(
      createRequest("DELETE", "/session-1"),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(store.assertAppRequest).toHaveBeenCalledTimes(1);
    expect(store.deleteHistory).toHaveBeenCalledWith("session-1");
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Stop the active scrape before deleting its history",
      code: "scrape_session_active",
    });
  });

  it("deletes terminal history and reports the retained contract", async () => {
    store.deleteHistory.mockReturnValue({ active: false, deleted: 4 });

    const response = await clear(createRequest("POST", "/../maintenance/scrape-history/clear"));

    expect(store.deleteHistory).toHaveBeenCalledWith();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, deleted: 4 });
  });

  it("returns 404 only for a missing targeted scrape-history session", async () => {
    store.deleteHistory.mockReturnValue({ active: false, deleted: 0 });

    const targeted = await DELETE(
      createRequest("DELETE", "/missing"),
      { params: Promise.resolve({ id: "missing" }) }
    );
    const collection = await clear(createRequest("POST", "/../maintenance/scrape-history/clear"));

    expect(targeted.status).toBe(404);
    await expect(targeted.json()).resolves.toMatchObject({
      code: "scrape_session_not_found",
      requestId: expect.any(String),
    });
    expect(collection.status).toBe(200);
  });

  it("requires a session ID before requesting cancellation", async () => {
    const response = await cancel(createRequest("POST"), { params: Promise.resolve({ id: "" }) });

    expect(response.status).toBe(400);
    expect(store.cancelSession).not.toHaveBeenCalled();
  });

  it("returns stopped when queue cancellation terminates the session", async () => {
    store.cancelSession.mockResolvedValue({
      cancelledQueued: 2,
      signalledRunning: 1,
      sessionStopped: true,
    });

    const response = await cancel(
      createRequest("POST", "/session-1/cancel"),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(store.cancelSession).toHaveBeenCalledWith("session-1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, stopped: true });
    expect(store.getSessionStatus).not.toHaveBeenCalled();
  });

  it("reports the current terminal status when no active work was stopped", async () => {
    store.getSessionStatus.mockReturnValue({ id: "session-1", status: "completed" });

    const response = await cancel(
      createRequest("POST", "/session-1/cancel"),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      stopped: false,
      status: "completed",
    });
  });

  it("returns 404 when cancellation targets an unknown session", async () => {
    const response = await cancel(
      createRequest("POST", "/missing/cancel"),
      { params: Promise.resolve({ id: "missing" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "Session not found",
      code: "scrape_session_not_found",
    });
  });
});
