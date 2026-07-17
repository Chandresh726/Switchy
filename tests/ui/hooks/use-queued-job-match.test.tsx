import type { PropsWithChildren } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useQueuedJobMatch } from "@/lib/hooks/use-queued-job-match";

describe("useQueuedJobMatch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("captures the queued session and polls it before invalidating job data", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const requests: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ method, url });
      if (method === "POST") {
        expect(init?.body).toBe(JSON.stringify({ jobId: 42 }));
        return Response.json({ sessionId: "session-42", status: "queued", total: 1 }, {
          status: 202,
        });
      }
      return Response.json({
        sessionId: "session-42",
        status: "completed",
        total: 1,
        completed: 1,
        succeeded: 1,
        failed: 0,
        startedAt: null,
        completedAt: new Date().toISOString(),
        analysis: {
          total: 1,
          completed: 1,
          active: 0,
          queued: 0,
          cached: 0,
          failed: 0,
        },
        matching: {
          total: 1,
          completed: 1,
          active: 0,
          queued: 0,
          cached: 0,
          failed: 0,
        },
        jobs: [],
        jobPagination: { total: 1, limit: 100, offset: 0, hasMore: false },
      });
    }));
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useQueuedJobMatch({
      jobId: 42,
      extraInvalidationKeys: [["job", 42]],
    }), { wrapper });

    await act(async () => result.current.mutation.mutateAsync());
    await waitFor(() => expect(requests).toContainEqual({
      method: "GET",
      url: "/api/match/sessions/session-42",
    }));
    await waitFor(() => expect(result.current.isMatching).toBe(false));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["jobs"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["job", 42] });
  });
});
