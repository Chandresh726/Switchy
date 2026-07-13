import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { SessionDetail } from "@/components/scrape-history/session-detail";

const SESSION_ID = "session/with spaces";

function sessionResponse(
  status: string,
  queueItems: Array<Record<string, unknown>> = [],
  logs: Array<Record<string, unknown>> = []
) {
  return {
    session: {
      id: SESSION_ID,
      triggerSource: "manual",
      status,
      companiesTotal: 2,
      companiesCompleted: status === "in_progress" ? 1 : 2,
      totalJobsFound: 8,
      totalJobsAdded: 3,
      totalJobsFiltered: 2,
      totalJobsArchived: 1,
      startedAt: "2026-07-13T10:00:00.000Z",
      completedAt:
        status === "in_progress" ? null : "2026-07-13T10:01:00.000Z",
    },
    logs,
    queueItems,
  };
}

function sessionLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    companyId: 7,
    companyName: "Acme",
    companyLogoUrl: null,
    platform: "eightfold",
    status: "error",
    jobsFound: 0,
    jobsAdded: 0,
    jobsUpdated: 0,
    jobsFiltered: 0,
    jobsArchived: 0,
    errorMessage: "browser session failed",
    duration: 100,
    startedAt: "2026-07-13T10:00:00.000Z",
    completedAt: "2026-07-13T10:00:01.000Z",
    matcherStatus: null,
    matcherJobsTotal: null,
    matcherJobsCompleted: null,
    matcherDuration: null,
    matcherErrorCount: null,
    attemptNumber: 1,
    attemptsTotal: 2,
    isFinalAttempt: false,
    ...overrides,
  };
}

function queueItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "queue-1",
    companyId: 7,
    companyName: "Acme",
    status: "running",
    attemptCount: 2,
    maxAttempts: 3,
    availableAt: "2026-07-13T10:00:00.000Z",
    workerId: "worker-1",
    lockedAt: "2026-07-13T10:00:01.000Z",
    leaseExpiresAt: "2026-07-13T10:01:00.000Z",
    cancelRequested: false,
    lastError: "previous attempt failed",
    startedAt: "2026-07-13T10:00:01.000Z",
    completedAt: null,
    createdAt: "2026-07-13T10:00:00.000Z",
    updatedAt: "2026-07-13T10:00:01.000Z",
    ...overrides,
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

describe("SessionDetail", () => {
  beforeEach(() => {
    mocks.push.mockReset();
  });

  it("shows durable retry, lease, and error metadata and blocks deletion while work is active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          sessionResponse("completed", [queueItem()], [sessionLog()])
        )
      )
    );

    renderWithQueryClient(<SessionDetail sessionId={SESSION_ID} />);

    expect(await screen.findByText("Company progress")).toBeTruthy();
    expect(screen.queryByText("Durable Work Queue")).toBeNull();
    expect(screen.queryByText("Company Logs")).toBeNull();
    expect(screen.getAllByText("Acme")).toHaveLength(1);
    expect(screen.getByText("Attempt 2 of 3")).toBeTruthy();
    expect(screen.getByText(/Lease until/)).toBeTruthy();
    expect(screen.getByText("previous attempt failed")).toBeTruthy();
    expect(screen.getByText("browser session failed")).toBeTruthy();
    const deleteButton = screen.getByRole("button", { name: "Delete Session" });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);
    expect(deleteButton.getAttribute("title")).toBe(
      "Wait for running queue work to stop"
    );
  });

  it("distinguishes superseded retries from final partial warnings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          sessionResponse("partial", [], [
            sessionLog(),
            sessionLog({
              id: 2,
              status: "partial",
              errorMessage: "one detail request failed",
              attemptNumber: 2,
              isFinalAttempt: true,
            }),
          ])
        )
      )
    );

    renderWithQueryClient(<SessionDetail sessionId={SESSION_ID} />);

    expect(await screen.findByText("Attempt 1 · superseded")).toBeTruthy();
    expect(screen.getByText("Attempt 2 · final")).toBeTruthy();
    expect(screen.getByText("one detail request failed")).toBeTruthy();
  });

  it("stops an active session through the authenticated PATCH contract", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return jsonResponse({ success: true, stopped: true });
      }
      return jsonResponse(sessionResponse("in_progress", [queueItem()]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithQueryClient(<SessionDetail sessionId={SESSION_ID} />);
    const stopButton = await screen.findByRole("button", { name: "Stop Session" });
    expect(
      (screen.getByRole("button", { name: "Delete Session" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    await user.click(stopButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/scrape-history?sessionId=${encodeURIComponent(SESSION_ID)}`,
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({ "x-switchy-request": "true" }),
        })
      )
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Stopping scrape session");
  });

  it("deletes a terminal idle session and navigates back to scrape history", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return jsonResponse({ success: true, deleted: 1 });
      }
      return jsonResponse(sessionResponse("completed"));
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderWithQueryClient(<SessionDetail sessionId={SESSION_ID} />);
    const deleteButton = await screen.findByRole("button", {
      name: "Delete Session",
    });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(deleteButton);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/history/scrape"));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/scrape-history?sessionId=${encodeURIComponent(SESSION_ID)}`,
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ "x-switchy-request": "true" }),
      })
    );
  });

  it("polls active sessions and stops polling after the session and queue become terminal", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(sessionResponse("in_progress", [queueItem()]))
      )
      .mockResolvedValueOnce(
        jsonResponse(
          sessionResponse("completed", [
            queueItem({ status: "completed", completedAt: "2026-07-13T10:01:00.000Z" }),
          ])
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    renderWithQueryClient(<SessionDetail sessionId={SESSION_ID} />);
    await vi.waitFor(() => {
      expect(screen.getByText("Processing Companies...")).toBeTruthy();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("renders a stable error state when session loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "boom" }, 500)));

    renderWithQueryClient(<SessionDetail sessionId={SESSION_ID} />);

    expect(await screen.findByText("Failed to load session details")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Back to History/ }).getAttribute("href")
    ).toBe("/history");
  });
});
