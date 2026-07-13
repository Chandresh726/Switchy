import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  handleApiError: vi.fn(),
  matchBulk: vi.fn(),
  matchSingle: vi.fn(),
  matchWithTracking: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: mocks.assertAppRequest,
  handleApiError: mocks.handleApiError,
  ValidationError: class ValidationError extends Error {},
}));

vi.mock("@/lib/api/ai-error-handler", () => ({
  handleAIAPIError: vi.fn(),
}));

vi.mock("@/lib/ai/matcher", () => ({
  matchBulk: mocks.matchBulk,
  matchSingle: mocks.matchSingle,
  matchWithTracking: mocks.matchWithTracking,
}));

vi.mock("@/lib/db", () => ({
  db: { select: mocks.select },
}));

import { POST as postCompanyMatch } from "@/app/api/companies/[id]/match/route";
import { POST as postCompaniesMatch } from "@/app/api/companies/match/route";
import { POST as postDirectMatch } from "@/app/api/match/route";

function createRequest(path: string, body: Record<string, unknown>): NextRequest {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as NextRequest;
}

function queueSelectResult(rows: unknown[]): void {
  mocks.select.mockReturnValueOnce({
    from: () => ({ where: () => Promise.resolve(rows) }),
  });
}

describe("synchronous match routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.matchWithTracking.mockResolvedValue({
      sessionId: "session-1",
      total: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  it("forwards bulk-company request cancellation to tracked matching", async () => {
    queueSelectResult([{ id: 11, companyId: 1 }]);
    const request = createRequest("/api/companies/match", {
      companyIds: [1],
    });

    const response = await postCompaniesMatch(request);

    expect(response.status).toBe(200);
    expect(mocks.matchWithTracking).toHaveBeenCalledWith([11], {
      triggerSource: "manual",
      signal: request.signal,
    });
  });

  it("forwards single-company request cancellation to tracked matching", async () => {
    queueSelectResult([{ id: 1, name: "Acme" }]);
    queueSelectResult([{ id: 11 }]);
    const request = createRequest("/api/companies/1/match", {});

    const response = await postCompanyMatch(request, {
      params: Promise.resolve({ id: "1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.matchWithTracking).toHaveBeenCalledWith([11], {
      triggerSource: "company_refresh",
      companyId: 1,
      signal: request.signal,
    });
  });

  it("forwards direct single-match request cancellation", async () => {
    mocks.matchSingle.mockResolvedValue({ score: 90 });
    const request = createRequest("/api/match", { jobId: 11 });

    const response = await postDirectMatch(request);

    expect(response.status).toBe(200);
    expect(mocks.matchSingle).toHaveBeenCalledWith(11, request.signal);
  });

  it("forwards direct bulk-match request cancellation", async () => {
    mocks.matchBulk.mockResolvedValue(new Map());
    const request = createRequest("/api/match", { jobIds: [11, 22] });

    const response = await postDirectMatch(request);

    expect(response.status).toBe(200);
    expect(mocks.matchBulk).toHaveBeenCalledWith(
      [11, 22],
      undefined,
      request.signal
    );
  });
});
