import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  getMatchPresentations: vi.fn(),
  getAIRunSummaries: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { select: mocks.select },
}));

vi.mock("@/lib/ai/matcher/presentation", () => ({
  getMatchPresentations: mocks.getMatchPresentations,
}));

vi.mock("@/lib/ai/observability", () => ({
  getAIRunSummaries: mocks.getAIRunSummaries,
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
    mocks.getAIRunSummaries.mockResolvedValue(new Map([
      ["analysis-run", {
        id: "analysis-run",
        capability: "job_analysis",
        status: "succeeded",
        provider: "openai",
        modelId: "analysis-model",
        attempts: 1,
      }],
      ["adjudication-run", {
        id: "adjudication-run",
        capability: "match_adjudication",
        status: "succeeded",
        provider: "openai",
        modelId: "adjudication-model",
        attempts: 1,
      }],
    ]));
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
      jobAnalysisId: "analysis-1",
      adjudicationRunId: "adjudication-run",
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
      .mockImplementationOnce(() => selectWhere([{ id: "analysis-1", aiRunId: "analysis-run" }]))
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
      analysisRunId: "analysis-run",
      analysisRun: {
        capability: "job_analysis",
        modelId: "analysis-model",
      },
      adjudicationRunId: "adjudication-run",
      adjudicationRun: {
        capability: "match_adjudication",
        modelId: "adjudication-model",
      },
    });
    expect(mocks.getAIRunSummaries).toHaveBeenCalledWith([
      "adjudication-run",
      "analysis-run",
    ]);
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

  it("chunks large history provenance lookups below SQLite parameter limits", async () => {
    const count = 401;
    const logs = Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      sessionId: "session-large",
      jobId: index + 1,
      status: "success",
      score: 70,
      matchResultId: `result-${index + 1}`,
      completedAt: new Date(),
    }));
    const results = logs.map((log) => ({
      id: log.matchResultId,
      jobId: log.jobId,
      score: 70,
      evidenceJson: JSON.stringify({
        reasons: [],
        matchedSkills: [],
        missingSkills: [],
        recommendations: [],
        componentEvidence: {},
      }),
      breakdownJson: JSON.stringify({}),
      confidence: 0.7,
      scoringPolicyVersion: "policy-v1",
      jobAnalysisId: `analysis-${log.jobId}`,
      adjudicationRunId: `adjudication-run-${log.jobId}`,
    }));
    const analyses = logs.map((log) => ({
      id: `analysis-${log.jobId}`,
      aiRunId: `analysis-run-${log.jobId}`,
    }));
    const jobRows = logs.map((log) => ({
      id: log.jobId,
      title: `Job ${log.jobId}`,
      description: "Description",
      location: null,
      locationType: "remote",
      seniorityLevel: null,
      department: null,
      employmentType: "full-time",
      salary: null,
    }));
    mocks.select
      .mockImplementationOnce(() => selectSession([{ id: "session-large" }]))
      .mockImplementationOnce(() => selectLogs(logs))
      .mockImplementationOnce(() => selectWhere(results.slice(0, 400)))
      .mockImplementationOnce(() => selectWhere(results.slice(400)))
      .mockImplementationOnce(() => selectWhere(analyses.slice(0, 400)))
      .mockImplementationOnce(() => selectWhere(analyses.slice(400)))
      .mockImplementationOnce(() => selectWhere(jobRows.slice(0, 400)))
      .mockImplementationOnce(() => selectWhere(jobRows.slice(400)));
    mocks.getMatchPresentations.mockResolvedValue(new Map(results.map((result) => [
      result.jobId,
      { matchResultId: result.id, matchStale: false },
    ])));
    mocks.getAIRunSummaries.mockResolvedValue(new Map(logs.flatMap((log) => ([
      [`adjudication-run-${log.jobId}`, {
        id: `adjudication-run-${log.jobId}`,
        capability: "match_adjudication",
        modelId: "adjudication-model",
      }],
      [`analysis-run-${log.jobId}`, {
        id: `analysis-run-${log.jobId}`,
        capability: "job_analysis",
        modelId: "analysis-model",
      }],
    ]))));

    const response = await GET(new Request(
      "http://localhost/api/match-history?sessionId=session-large"
    ) as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logs).toHaveLength(count);
    expect(mocks.select).toHaveBeenCalledTimes(8);
    expect(mocks.getAIRunSummaries).toHaveBeenCalledWith(
      Array.from({ length: count }, (_, index) => [
        `adjudication-run-${index + 1}`,
        `analysis-run-${index + 1}`,
      ]).flat()
    );
    expect(body.logs.map((log: {
      jobId: number;
      analysisRunId: string;
      analysisRun: { id: string; modelId: string };
      adjudicationRunId: string;
      adjudicationRun: { id: string; modelId: string };
    }) => ({
      jobId: log.jobId,
      analysisRunId: log.analysisRunId,
      analysisRun: {
        id: log.analysisRun.id,
        modelId: log.analysisRun.modelId,
      },
      adjudicationRunId: log.adjudicationRunId,
      adjudicationRun: {
        id: log.adjudicationRun.id,
        modelId: log.adjudicationRun.modelId,
      },
    }))).toEqual(logs.map((log) => ({
      jobId: log.jobId,
      analysisRunId: `analysis-run-${log.jobId}`,
      analysisRun: {
        id: `analysis-run-${log.jobId}`,
        modelId: "analysis-model",
      },
      adjudicationRunId: `adjudication-run-${log.jobId}`,
      adjudicationRun: {
        id: `adjudication-run-${log.jobId}`,
        modelId: "adjudication-model",
      },
    })));
    expect(body.logs[0]).toMatchObject({
      analysisRunId: "analysis-run-1",
      analysisRun: { id: "analysis-run-1", modelId: "analysis-model" },
      adjudicationRunId: "adjudication-run-1",
      adjudicationRun: { id: "adjudication-run-1", modelId: "adjudication-model" },
    });
    expect(body.logs[count - 1]).toMatchObject({
      analysisRunId: `analysis-run-${count}`,
      analysisRun: { id: `analysis-run-${count}`, modelId: "analysis-model" },
      adjudicationRunId: `adjudication-run-${count}`,
      adjudicationRun: {
        id: `adjudication-run-${count}`,
        modelId: "adjudication-model",
      },
    });
  });
});
