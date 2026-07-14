import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  getMatchPresentations: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mocks.select },
}));

vi.mock("@/lib/ai/matcher/presentation", () => ({
  getMatchPresentations: mocks.getMatchPresentations,
}));

vi.mock("@/lib/scraper/maintenance", () => ({
  getLocalDataMaintenanceService: vi.fn(),
}));

vi.mock("@/lib/scraper/matching/lifecycle", () => ({
  stopMatchSession: vi.fn(),
}));

import { GET } from "@/app/api/match-history/route";

function selectSession(result: unknown[]) {
  return {
    from: () => ({
      leftJoin: () => ({
        where: vi.fn().mockResolvedValue(result),
      }),
    }),
  };
}

function selectLogs(result: unknown[]) {
  const chain = {
    leftJoin: () => chain,
    where: () => ({
      orderBy: vi.fn().mockResolvedValue(result),
    }),
  };
  return { from: () => chain };
}

function selectWhere(result: unknown[]) {
  return {
    from: () => ({
      where: vi.fn().mockResolvedValue(result),
    }),
  };
}

describe("match history detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the exact immutable result linked by a successful log", async () => {
    const session = { id: "session-1", status: "completed" };
    const logs = [{
      id: 1,
      sessionId: "session-1",
      jobId: 42,
      jobTitle: "Engineer",
      companyName: "Acme",
      status: "success",
      score: 70,
      matchResultId: "result-linked",
      attemptCount: 1,
      errorType: null,
      errorMessage: null,
      duration: 100,
      modelUsed: "model",
      completedAt: new Date(),
    }];
    const result = {
      id: "result-linked",
      jobId: 42,
      score: 88,
      evidenceJson: JSON.stringify({
        reasons: ["Exact result"],
        matchedSkills: ["typescript"],
        missingSkills: [],
        recommendations: [],
        componentEvidence: {},
      }),
      breakdownJson: JSON.stringify({ mustHaveSkills: 100 }),
      confidence: 0.9,
      scoringPolicyVersion: "policy-v1",
    };
    const job = {
      id: 42,
      title: "Engineer",
      description: "Build services",
      location: null,
      locationType: "remote",
      seniorityLevel: "mid",
      department: "Engineering",
      employmentType: "full-time",
      salary: null,
    };
    mocks.select
      .mockImplementationOnce(() => selectSession([session]))
      .mockImplementationOnce(() => selectLogs(logs))
      .mockImplementationOnce(() => selectWhere([result]))
      .mockImplementationOnce(() => selectWhere([job]));
    mocks.getMatchPresentations.mockResolvedValue(new Map([[42, {
      matchResultId: "result-linked",
      matchStale: false,
    }]]));

    const response = await GET(new Request(
      "http://localhost/api/match-history?sessionId=session-1"
    ) as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logs[0]).toMatchObject({
      score: 88,
      matchResultId: "result-linked",
      reasons: ["Exact result"],
      matchStale: false,
    });
  });

  it("never attaches an immutable result to a failed log", async () => {
    const logs = [{
      id: 2,
      sessionId: "session-1",
      jobId: 42,
      status: "failed",
      score: null,
      matchResultId: "result-from-another-attempt",
      completedAt: new Date(),
    }];
    mocks.select
      .mockImplementationOnce(() => selectSession([{ id: "session-1" }]))
      .mockImplementationOnce(() => selectLogs(logs))
      .mockImplementationOnce(() => selectWhere([{ id: "result-from-another-attempt" }]))
      .mockImplementationOnce(() => selectWhere([]));
    mocks.getMatchPresentations.mockResolvedValue(new Map());

    const response = await GET(new Request(
      "http://localhost/api/match-history?sessionId=session-1"
    ) as NextRequest);
    const body = await response.json();

    expect(body.logs[0]).toMatchObject({
      status: "failed",
      score: null,
      matchResultId: null,
      matchStale: false,
    });
  });
});
