import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

import { MatchSessionDetail } from "@/components/history/match-session-detail";

const SESSION_ID = "match/session with spaces";

const emptyPhase = {
  total: 0,
  completed: 0,
  active: 0,
  queued: 0,
  cached: 0,
  failed: 0,
};

function matchLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    sessionId: SESSION_ID,
    jobId: 42,
    jobTitle: "Staff Engineer",
    companyName: "Acme",
    companyLogoUrl: "https://example.com/acme.png",
    status: "success",
    score: 87.4,
    attemptCount: 1,
    errorType: null,
    errorMessage: null,
    duration: 2_500,
    modelUsed: "gpt-5",
    completedAt: "2026-07-13T10:00:05.000Z",
    ...overrides,
  };
}

function aiRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "analysis-run-1",
    capability: "job_analysis",
    provider: "openai",
    modelId: "gpt-5",
    status: "succeeded",
    attempts: 2,
    inputTokens: 120,
    inputNoCacheTokens: 80,
    inputCacheReadTokens: 40,
    inputCacheWriteTokens: 0,
    outputTokens: 30,
    outputTextTokens: 20,
    outputReasoningTokens: 10,
    totalTokens: 150,
    durationMs: 1_250,
    finishReason: "stop",
    providerRequestId: "request-abc",
    providerConfigFingerprint: "a".repeat(64),
    cacheStatus: "miss",
    qualityResult: "passed",
    warningCodes: [],
    errorCode: null,
    errorMessage: null,
    startedAt: "2026-07-13T10:00:00.000Z",
    completedAt: "2026-07-13T10:00:01.250Z",
    attemptHistory: [{
      attemptNumber: 1,
      status: "failed",
      inputTokens: 60,
      inputNoCacheTokens: 40,
      inputCacheReadTokens: 20,
      inputCacheWriteTokens: 0,
      outputTokens: 0,
      outputTextTokens: 0,
      outputReasoningTokens: 0,
      totalTokens: 60,
      durationMs: 500,
      finishReason: null,
      providerRequestId: "request-first",
      warningCodes: [],
      errorCode: "rate_limit",
      retryDelayMs: 250,
      startedAt: "2026-07-13T10:00:00.000Z",
      completedAt: "2026-07-13T10:00:00.500Z",
    }],
    ...overrides,
  };
}

function pipelineJob(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 42,
    jobTitle: "Staff Engineer",
    companyName: "Acme",
    analysisStatus: "ready",
    matchStatus: "completed",
    errorStage: null,
    errorCode: null,
    errorMessage: null,
    analysisStartedAt: null,
    analysisCompletedAt: null,
    matchStartedAt: null,
    matchCompletedAt: null,
    updatedAt: "2026-07-13T10:00:05.000Z",
    ...overrides,
  };
}

function detailResponse(
  status: string,
  logs: Array<Record<string, unknown>> = [],
  logTotal = logs.length,
  pipeline: Partial<{
    analysis: typeof emptyPhase;
    matching: typeof emptyPhase;
    jobs: Array<Record<string, unknown>>;
  }> = {}
) {
  return {
    session: {
      id: SESSION_ID,
      triggerSource: "company_refresh",
      companyId: 7,
      companyName: "Acme",
      status,
      jobsTotal: 4,
      jobsCompleted: 4,
      jobsSucceeded: 3,
      jobsFailed: 1,
      errorCount: 1,
      startedAt: "2026-07-13T10:00:00.000Z",
      completedAt: status === "in_progress" ? null : "2026-07-13T10:00:30.000Z",
    },
    logs,
    logPagination: { total: logTotal, limit: 50, offset: 0, hasMore: logTotal > 50 },
    pipeline: {
      analysis: pipeline.analysis ?? emptyPhase,
      matching: pipeline.matching ?? emptyPhase,
      jobs: pipeline.jobs ?? [],
      jobPagination: {
        total: pipeline.jobs?.length ?? 0,
        limit: 50,
        offset: 0,
        hasMore: false,
      },
    },
  };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("MatchSessionDetail", () => {
  beforeEach(() => {
    mocks.push.mockReset();
  });

  it("summarises the session and links each job result to its job page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(detailResponse("completed", [matchLog()])))
    );

    renderWithQueryClient(<MatchSessionDetail sessionId={SESSION_ID} />);

    expect(await screen.findByText("Job results")).toBeTruthy();
    expect(screen.getByText("4/4")).toBeTruthy();
    expect(screen.getByText("matched")).toBeTruthy();
    expect(screen.getByText("87")).toBeTruthy();

    const link = screen.getByRole("link", { name: /Staff Engineer/ });
    expect(link.getAttribute("href")).toBe("/jobs/42");
  });

  it("keeps the overview to phase totals and does not repeat each job", async () => {
    const phase = { ...emptyPhase, total: 4, completed: 4 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          detailResponse("completed", [matchLog()], 1, {
            analysis: phase,
            matching: phase,
            jobs: [pipelineJob()],
          })
        )
      )
    );

    renderWithQueryClient(<MatchSessionDetail sessionId={SESSION_ID} />);

    expect(await screen.findByText("Job analysis")).toBeTruthy();
    expect(screen.getByText("Final matching")).toBeTruthy();
    // The pipeline row and the job result row would otherwise both render it.
    expect(screen.getAllByText("Staff Engineer")).toHaveLength(1);
    expect(screen.queryByText("Matched")).toBeNull();
  });

  it("shows the failure reason for failed jobs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          detailResponse("completed", [
            matchLog({
              status: "failed",
              score: null,
              attemptCount: 3,
              errorType: "rate_limit",
              errorMessage: "provider rejected the request",
              analysisRunId: "analysis-run-1",
              analysisRun: aiRun({ status: "failed", attempts: 3 }),
            }),
          ])
        )
      )
    );

    renderWithQueryClient(<MatchSessionDetail sessionId={SESSION_ID} />);

    expect(await screen.findByText("provider rejected the request")).toBeTruthy();
    expect(screen.getByText("rate_limit")).toBeTruthy();
    expect(screen.queryByText("3 attempts")).toBeNull();
    expect(screen.getByText("AI telemetry · 1 run")).toBeTruthy();
    expect(screen.getByText("Attempts").parentElement?.textContent).toBe("Attempts3");
    expect(screen.getAllByText("failed")).toHaveLength(2);
    expect(screen.getByText("1 failed")).toBeTruthy();
  });

  it("shows compact card metadata and streamlined telemetry for each job", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          detailResponse("completed", [
            matchLog({
              analysisRunId: "analysis-run-1",
              analysisRun: aiRun(),
              matchRunId: "match-run-1",
              matchRun: aiRun({
                id: "match-run-1",
                capability: "match_evaluation",
              }),
            }),
          ])
        )
      )
    );

    renderWithQueryClient(<MatchSessionDetail sessionId={SESSION_ID} />);

    const telemetrySummary = await screen.findByText("AI telemetry · 2 runs");
    const telemetry = telemetrySummary.closest("details");
    expect(screen.getByRole("img", { name: "Acme" })).toBeTruthy();
    expect(screen.getByText("openai · gpt-5")).toBeTruthy();
    expect(screen.queryByText("2 attempts")).toBeNull();

    expect(screen.getByText("Job analysis")).toBeTruthy();
    expect(screen.getByText("Match evaluation")).toBeTruthy();
    expect(screen.getAllByText("Attempts")).toHaveLength(2);
    expect(screen.getAllByText("Total tokens")).toHaveLength(2);
    expect(screen.getAllByText("Input tokens")).toHaveLength(2);
    expect(screen.getAllByText("Output tokens")).toHaveLength(2);
    expect(screen.getAllByText("Duration")).toHaveLength(2);
    expect(telemetry?.querySelector("[data-matching-telemetry-runs]")?.className).toContain("flex");
    expect(telemetry?.textContent).not.toContain("openai · gpt-5");
    expect(telemetry?.textContent).not.toContain("succeeded");
    expect(telemetry?.textContent).not.toContain("Cache");
    expect(telemetry?.textContent).not.toContain("Finish reason");
    expect(telemetry?.textContent).not.toContain("Quality");
    expect(telemetry?.textContent).not.toContain("request-abc");
    expect(telemetry?.textContent).not.toContain("Request request-first");
    expect(telemetry?.textContent).not.toContain("Provider configuration fingerprint");
  });

  it("renders a job result that has no job to link to as non-interactive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          detailResponse("completed", [matchLog({ jobId: null, jobTitle: null })])
        )
      )
    );

    renderWithQueryClient(<MatchSessionDetail sessionId={SESSION_ID} />);

    expect(await screen.findByText("Untitled Job")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Untitled Job/ })).toBeNull();
  });

  it("only paginates once the records overflow a single page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(detailResponse("completed", [matchLog()])))
    );

    const { unmount } = renderWithQueryClient(
      <MatchSessionDetail sessionId={SESSION_ID} />
    );
    expect(await screen.findByText("Job results")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: /pagination/i })).toBeNull();
    unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(detailResponse("completed", [matchLog()], 120)))
    );

    renderWithQueryClient(<MatchSessionDetail sessionId={SESSION_ID} />);
    expect(
      await screen.findByRole("navigation", { name: "Match session records pagination" })
    ).toBeTruthy();
  });
});
