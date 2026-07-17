import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  handleApiError: vi.fn(),
  fetchCompanyJobIds: vi.fn(),
  completeEmptyMatchSession: vi.fn(),
  queueMatchWork: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: mocks.assertAppRequest,
  handleApiError: mocks.handleApiError,
  ValidationError: class ValidationError extends Error {},
}));
vi.mock("@/lib/ai/work-items", () => ({
  completeEmptyMatchSession: mocks.completeEmptyMatchSession,
  fetchCompanyJobIds: mocks.fetchCompanyJobIds,
  queueMatchWork: mocks.queueMatchWork,
}));
import { POST as postCompaniesMatch } from "@/app/api/companies/match/route";
import { POST as postDirectMatch } from "@/app/api/match/route";

function createRequest(path: string, body: Record<string, unknown>): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("durable match routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCompanyJobIds.mockResolvedValue([11]);
    mocks.queueMatchWork.mockReturnValue({
      sessionId: "session-1",
      status: "queued",
      total: 1,
    });
    mocks.completeEmptyMatchSession.mockReturnValue({
      sessionId: "empty-session",
      status: "completed",
      total: 0,
    });
  });

  it("queues bulk-company matching and returns 202 without request-lifetime execution", async () => {
    const response = await postCompaniesMatch(createRequest("/api/companies/match", {
      companyIds: [1],
    }));

    expect(response.status).toBe(202);
    expect(mocks.fetchCompanyJobIds).toHaveBeenCalledWith([1]);
    expect(mocks.queueMatchWork).toHaveBeenCalledWith({
      jobIds: [11],
      triggerSource: "manual",
    });
    await expect(response.json()).resolves.toEqual({
      sessionId: "session-1",
      status: "queued",
      total: 1,
    });
  });

  it("creates a pollable completed session for a bulk-company no-op", async () => {
    mocks.fetchCompanyJobIds.mockResolvedValue([]);

    const response = await postCompaniesMatch(createRequest("/api/companies/match", {
      companyIds: [1],
    }));

    expect(response.status).toBe(202);
    expect(mocks.completeEmptyMatchSession).toHaveBeenCalledWith({
      triggerSource: "manual",
    });
    await expect(response.json()).resolves.toEqual({
      sessionId: "empty-session",
      status: "completed",
      total: 0,
    });
  });

  it("queues a direct single job", async () => {
    const response = await postDirectMatch(createRequest("/api/match", { jobId: 11 }));
    expect(response.status).toBe(202);
    expect(mocks.queueMatchWork).toHaveBeenCalledWith({
      jobIds: [11],
      triggerSource: "manual",
    });
  });

  it("queues a direct job batch as one durable session", async () => {
    const response = await postDirectMatch(createRequest("/api/match", { jobIds: [11, 22] }));
    expect(response.status).toBe(202);
    expect(mocks.queueMatchWork).toHaveBeenCalledWith({
      jobIds: [11, 22],
      triggerSource: "manual",
    });
  });
});
