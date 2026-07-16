import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobCard } from "@/components/jobs/job-card";

describe("JobCard match actions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes status queries and polls the session returned by the match action", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const requests: Array<{ method: string; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ method, url });
      if (method === "PATCH") return Response.json({ id: 42, status: "applied" });
      if (method === "POST") {
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
      });
    }));
    render(
      <QueryClientProvider client={queryClient}>
        <JobCard job={{
          id: 42,
          title: "Synthetic Engineer",
          url: "https://example.test/jobs/42",
          location: "Remote",
          locationType: "remote",
          department: "Engineering",
          salary: null,
          employmentType: "full-time",
          seniorityLevel: "senior",
          status: "new",
          matchScore: null,
          postedDate: null,
          discoveredAt: new Date().toISOString(),
          company: { id: 7, name: "Example", logoUrl: null, platform: "custom" },
        }} />
      </QueryClientProvider>
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Mark Applied" }));
    await waitFor(() => expect(requests).toContainEqual({ method: "PATCH", url: "/api/jobs/42" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["jobs"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["stats"] });

    await user.click(screen.getByRole("button", { name: "Score" }));
    await waitFor(() => expect(requests).toContainEqual({ method: "POST", url: "/api/match" }));
    await waitFor(() => expect(requests).toContainEqual({
      method: "GET",
      url: "/api/match/sessions/session-42",
    }));
  });
});
