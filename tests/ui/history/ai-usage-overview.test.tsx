import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AIUsageOverview } from "@/components/history/ai-usage-overview";

function usage(days: 7 | 30) {
  return {
    days,
    periodStart: "2026-07-07T00:00:00.000Z",
    periodEnd: "2026-07-14T00:00:00.000Z",
    executions: days === 7 ? 10 : 25,
    calls: days === 7 ? 12 : 30,
    succeeded: 10,
    failed: 2,
    running: 0,
    cancelled: 0,
    successRate: 83,
    inputTokens: 1_000,
    outputTokens: 500,
    totalTokens: 1_500,
    averageLatencyMs: 1_250,
    fullMatchCacheReuses: 4,
    capabilities: [{
      capability: "job_analysis",
      executions: 7,
      calls: 8,
      succeeded: 8,
      failed: 0,
      totalTokens: 1_000,
      averageLatencyMs: 800,
    }],
    failures: [{ code: "timeout", count: 2 }],
  };
}

describe("AIUsageOverview", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows local telemetry and switches between seven and thirty days", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      return Response.json(usage(url.includes("days=30") ? 30 : 7));
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AIUsageOverview />
      </QueryClientProvider>
    );

    expect(await screen.findByText("12")).toBeTruthy();
    expect(screen.getByText("1.5K")).toBeTruthy();
    expect(screen.getByText("Full match reuse")).toBeTruthy();
    expect(screen.getByText(/Currency is not estimated/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "30 days" }));
    await waitFor(() => expect(requests).toContain("/api/ai/usage?days=30"));
    expect(await screen.findByText("30")).toBeTruthy();
  });

  it("shows a retry action when usage cannot be loaded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json(usage(7)));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AIUsageOverview />
      </QueryClientProvider>
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "AI usage could not be loaded."
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("12")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
