import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  completeEmptyMatchSession: vi.fn(),
  getUnmatchedJobCount: vi.fn(),
  getUnmatchedJobIds: vi.fn(),
  getAIWorkSession: vi.fn(),
  queueMatchWork: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ assertAppRequest: mocks.assertAppRequest }));
vi.mock("@/lib/api/ai-error-handler", () => ({
  handleAIAPIError: vi.fn(),
}));
vi.mock("@/lib/ai/matcher", () => ({
  getUnmatchedJobCount: mocks.getUnmatchedJobCount,
  getUnmatchedJobIds: mocks.getUnmatchedJobIds,
}));
vi.mock("@/lib/ai/work-items", () => ({
  completeEmptyMatchSession: mocks.completeEmptyMatchSession,
  getAIWorkSession: mocks.getAIWorkSession,
  queueMatchWork: mocks.queueMatchWork,
}));

import { GET, POST } from "@/app/api/jobs/match-unmatched/route";

describe("match-unmatched route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts only unmatched jobs found inside the selected window", async () => {
    mocks.getUnmatchedJobCount.mockResolvedValue(14);

    const response = await GET(
      new Request("http://localhost/api/jobs/match-unmatched?days=10")
    );

    expect(mocks.getUnmatchedJobCount).toHaveBeenCalledWith({
      discoveredSince: new Date("2026-07-06T12:00:00.000Z"),
    });
    await expect(response.json()).resolves.toEqual({ count: 14, days: 10 });
  });

  it("creates a pollable completed session when every job is already fresh", async () => {
    mocks.getUnmatchedJobIds.mockResolvedValue([]);
    mocks.completeEmptyMatchSession.mockReturnValue({
      sessionId: "empty-unmatched-session",
      status: "completed",
      total: 0,
    });
    const request = new Request("http://localhost/api/jobs/match-unmatched", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 5 }),
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(mocks.completeEmptyMatchSession).toHaveBeenCalledWith({
      triggerSource: "match_unmatched",
    });
    expect(mocks.getUnmatchedJobIds).toHaveBeenCalledWith({
      discoveredSince: new Date("2026-07-11T12:00:00.000Z"),
    });
    await expect(response.json()).resolves.toEqual({
      sessionId: "empty-unmatched-session",
      status: "completed",
      total: 0,
    });
  });

  it("queues only IDs returned for the confirmed discovery window", async () => {
    mocks.getUnmatchedJobIds.mockResolvedValue([41, 42]);
    mocks.queueMatchWork.mockReturnValue({
      sessionId: "recent-unmatched-session",
      status: "queued",
      total: 2,
    });
    const request = new Request("http://localhost/api/jobs/match-unmatched", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 30 }),
    });

    const response = await POST(request);

    expect(mocks.getUnmatchedJobIds).toHaveBeenCalledWith({
      discoveredSince: new Date("2026-06-16T12:00:00.000Z"),
    });
    expect(mocks.queueMatchWork).toHaveBeenCalledWith({
      jobIds: [41, 42],
      triggerSource: "match_unmatched",
    });
    expect(response.status).toBe(202);
  });
});
