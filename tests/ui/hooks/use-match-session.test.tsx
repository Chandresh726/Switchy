import type { PropsWithChildren } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMatchSession } from "@/lib/hooks/use-match-session";

describe("useMatchSession", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("polls to a terminal result and invalidates consumers once", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const onSettled = vi.fn();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return Response.json({
        sessionId: "session-1",
        status: calls === 1 ? "in_progress" : "completed",
        total: 1,
        completed: calls === 1 ? 0 : 1,
        succeeded: calls === 1 ? 0 : 1,
        failed: 0,
        startedAt: null,
        completedAt: calls === 1 ? null : new Date().toISOString(),
        analysis: {
          total: 1,
          completed: calls === 1 ? 0 : 1,
          active: calls === 1 ? 1 : 0,
          queued: 0,
          cached: 0,
          failed: 0,
        },
        matching: {
          total: 1,
          completed: calls === 1 ? 0 : 1,
          active: calls === 1 ? 1 : 0,
          queued: 0,
          cached: 0,
          failed: 0,
        },
        jobs: [],
      });
    }));
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useMatchSession("session-1", { onSettled }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.status).toBe("in_progress"));
    await result.current.refetch();
    await waitFor(() => expect(result.current.data?.status).toBe("completed"));
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["jobs"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["match-history"] });
    await result.current.refetch();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
