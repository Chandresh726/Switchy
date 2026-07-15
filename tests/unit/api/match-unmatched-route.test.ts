import { describe, expect, it, vi } from "vitest";

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

import { POST } from "@/app/api/jobs/match-unmatched/route";

describe("match-unmatched route", () => {
  it("creates a pollable completed session when every job is already fresh", async () => {
    mocks.getUnmatchedJobIds.mockResolvedValue([]);
    mocks.completeEmptyMatchSession.mockReturnValue({
      sessionId: "empty-unmatched-session",
      status: "completed",
      total: 0,
    });
    const request = new Request("http://localhost/api/jobs/match-unmatched", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(mocks.completeEmptyMatchSession).toHaveBeenCalledWith({
      triggerSource: "match_unmatched",
    });
    await expect(response.json()).resolves.toEqual({
      sessionId: "empty-unmatched-session",
      status: "completed",
      total: 0,
    });
  });
});
