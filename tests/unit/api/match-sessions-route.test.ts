import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  getAIWorkSession: vi.fn(),
  stopAIWorkSession: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ assertAppRequest: mocks.assertAppRequest }));
vi.mock("@/lib/ai/work-items", () => ({
  getAIWorkSession: mocks.getAIWorkSession,
  stopAIWorkSession: mocks.stopAIWorkSession,
}));

import { DELETE, GET } from "@/app/api/match/sessions/[id]/route";

describe("match session API", () => {
  it("presents standardized progress", async () => {
    mocks.getAIWorkSession.mockResolvedValue({
      id: "session-1",
      status: "in_progress",
      jobsTotal: 4,
      jobsCompleted: 2,
      jobsSucceeded: 2,
      jobsFailed: 0,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: null,
      pipeline: {
        analysis: { total: 4, completed: 3, active: 1, queued: 0, cached: 1, failed: 0 },
        matching: { total: 4, completed: 2, active: 1, queued: 1, cached: 0, failed: 0 },
        jobs: [],
      },
    });
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: "session-1",
      status: "in_progress",
      total: 4,
      completed: 2,
      succeeded: 2,
      failed: 0,
      analysis: expect.objectContaining({ completed: 3, active: 1 }),
      matching: expect.objectContaining({ completed: 2, active: 1 }),
    });
  });

  it("requests durable cancellation", async () => {
    mocks.stopAIWorkSession.mockResolvedValue({
      exists: true,
      stopped: true,
      status: "cancelled",
    });
    const response = await DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(mocks.stopAIWorkSession).toHaveBeenCalledWith("session-1");
    await expect(response.json()).resolves.toEqual({
      sessionId: "session-1",
      status: "cancelled",
      cancellationRequested: true,
    });
  });
});
