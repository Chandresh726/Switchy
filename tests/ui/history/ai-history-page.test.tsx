import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AIHistoryPage from "@/app/(dashboard)/history/ai/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("AIHistoryPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts usage loading without waiting for writing history", async () => {
    let resolveHistory: ((response: Response) => void) | undefined;
    const historyResponse = new Promise<Response>((resolve) => {
      resolveHistory = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/ai/history") return historyResponse;
      if (url === "/api/ai/usage?days=7") {
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
          fullMatchCacheReuses: 0,
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
        <AIHistoryPage />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/ai/history", {
        method: "GET",
        cache: "no-store",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/usage?days=7",
        { method: "GET", cache: "no-store" }
      );
    });

    await act(async () => {
      resolveHistory?.(Response.json({ contents: [] }));
      await historyResponse;
    });
  });
});
