import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import AIWritingHistoryPage from "@/app/(dashboard)/history/ai/writing/page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

describe("AIWritingHistoryPage", () => {
  afterEach(() => {
    mocks.push.mockReset();
    vi.unstubAllGlobals();
  });

  it("starts usage loading without waiting for writing history", async () => {
    let resolveHistory: ((response: Response) => void) | undefined;
    const historyResponse = new Promise<Response>((resolve) => {
      resolveHistory = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/ai/history") return historyResponse;
      if (url === "/api/ai/usage?days=7&group=writing") {
        return Promise.resolve(Response.json({
          days: 7,
          periodStart: "2026-07-08T00:00:00.000Z",
          periodEnd: "2026-07-15T00:00:00.000Z",
          executions: 0,
          calls: 0,
          succeeded: 0,
          failed: 0,
          running: 0,
          cancelled: 0,
          successRate: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          averageLatencyMs: 0,
          capabilities: [],
          failures: [],
        }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AIWritingHistoryPage />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/ai/history", {
        method: "GET",
        cache: "no-store",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/usage?days=7&group=writing",
        { method: "GET", cache: "no-store" }
      );
    });

    await act(async () => {
      resolveHistory?.(Response.json({ contents: [] }));
      await historyResponse;
    });
  });

  it("shows a streamlined writing card and opens the current variant", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/ai/history") {
        return Response.json({
          contents: [{
            id: 1,
            jobId: 8,
            type: "cover_letter",
            content: "Initial draft",
            currentVariantId: 11,
            settingsSnapshot: null,
            createdAt: "2026-07-15T00:00:00.000Z",
            updatedAt: "2026-07-15T00:05:00.000Z",
            jobTitle: "Staff Engineer",
            companyName: "Acme",
            companyLogoUrl: null,
            history: [{
              id: 10,
              variant: "Initial draft",
              userPrompt: null,
              parentVariantId: null,
              aiRunId: null,
              aiRun: null,
              source: "generated",
              selectedAt: "2026-07-15T00:00:00.000Z",
              copiedAt: null,
              discardedAt: null,
              editDistance: null,
              editDistanceRatio: null,
              createdAt: "2026-07-15T00:00:00.000Z",
              events: [{
                id: 1,
                action: "selected",
                source: "generated",
                createdAt: "2026-07-15T00:00:00.000Z",
              }],
            }, {
              id: 11,
              variant: "Current draft",
              userPrompt: "Make it concise",
              parentVariantId: 10,
              aiRunId: "writing-run-1",
              aiRun: {
                id: "writing-run-1",
                capability: "writing_cover_letter",
                provider: "openai",
                modelId: "gpt-5",
                status: "succeeded",
                attempts: 1,
                inputTokens: 100,
                outputTokens: 20,
                outputReasoningTokens: 5,
                totalTokens: 120,
                durationMs: 800,
                finishReason: "stop",
                providerRequestId: "writing-request-1",
                providerConfigFingerprint: "b".repeat(64),
                cacheStatus: "miss",
                qualityResult: "not_checked",
                errorCode: null,
                startedAt: "2026-07-15T00:04:59.200Z",
                completedAt: "2026-07-15T00:05:00.000Z",
              },
              source: "generated",
              selectedAt: "2026-07-15T00:05:00.000Z",
              copiedAt: "2026-07-15T00:05:01.000Z",
              discardedAt: null,
              editDistance: 5,
              editDistanceRatio: 0.1,
              createdAt: "2026-07-15T00:05:00.000Z",
              events: [{
                id: 2,
                action: "selected",
                source: "generated",
                createdAt: "2026-07-15T00:05:00.000Z",
              }, {
                id: 3,
                action: "copied",
                source: "copy",
                createdAt: "2026-07-15T00:05:01.000Z",
              }],
            }],
          }],
        });
      }
      if (url === "/api/ai/usage?days=7&group=writing") {
        return Response.json({
          days: 7,
          periodStart: "2026-07-08T00:00:00.000Z",
          periodEnd: "2026-07-15T00:00:00.000Z",
          executions: 1,
          calls: 1,
          succeeded: 1,
          failed: 0,
          running: 0,
          cancelled: 0,
          successRate: 100,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          averageLatencyMs: 800,
          capabilities: [],
          failures: [],
        });
      }
      return new Response(null, { status: 404 });
    }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AIWritingHistoryPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Staff Engineer")).toBeTruthy();
    expect(screen.queryByText("Current #11")).toBeNull();
    expect(screen.queryByText("2 selected")).toBeNull();
    expect(screen.getByText("Cover Letter")).toBeTruthy();
    expect(screen.getByText("1 copied")).toBeTruthy();
    expect(screen.getByText("openai · gpt-5")).toBeTruthy();
    expect(screen.queryByText("openai · gpt-5 · 120 tokens")).toBeNull();
    expect(screen.getByText("AI telemetry · 1 run")).toBeTruthy();

    const telemetrySummary = screen.getByText("AI telemetry · 1 run");
    const telemetry = telemetrySummary.closest("details");
    expect(telemetry).toBeTruthy();
    await userEvent.click(telemetrySummary);
    const telemetryView = within(telemetry!);
    expect(telemetryView.getByText("Total tokens")).toBeTruthy();
    expect(telemetryView.getByText("Input tokens")).toBeTruthy();
    expect(telemetryView.getByText("Output tokens")).toBeTruthy();
    expect(telemetryView.getByText("Reasoning tokens")).toBeTruthy();
    expect(telemetryView.getByText("Duration")).toBeTruthy();
    expect(telemetryView.queryByText("Writing generation")).toBeNull();
    expect(telemetryView.queryByText("openai · gpt-5")).toBeNull();
    expect(telemetryView.queryByText("succeeded")).toBeNull();
    expect(telemetryView.queryByText("Attempts")).toBeNull();
    expect(telemetryView.queryByText("Cache read")).toBeNull();
    expect(telemetryView.queryByText("Provider request ID")).toBeNull();
    expect(telemetryView.queryByText("writing-request-1")).toBeNull();
    expect(telemetryView.queryByText("Quality")).toBeNull();
    expect(telemetryView.queryByText("Finish reason")).toBeNull();
    expect(
      telemetry?.querySelector<HTMLElement>("[data-inline-telemetry-metrics]")
        ?.style.gridTemplateColumns
    ).toBe("repeat(5, minmax(0, 1fr))");

    await userEvent.click(screen.getByRole("button", { name: /Staff Engineer/ }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/jobs/8/cover-letter?variantId=11"
    );
  });
});
