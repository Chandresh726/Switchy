import type { PropsWithChildren } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SchedulerHostBadge } from "@/components/settings/scheduler-host-badge";

function renderBadge(host: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    serverAgentSupported: true,
    serverAgentLoaded: null,
    tickAgentLoaded: null,
    ...host,
  })));
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<SchedulerHostBadge />, { wrapper });
}

describe("SchedulerHostBadge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders nothing when the background service is installed", async () => {
    renderBadge({
      platform: "darwin",
      supported: true,
      serverAgentInstalled: true,
      tickAgentInstalled: true,
      schedulerEnabled: true,
    });

    await waitFor(() =>
      expect(screen.queryByText("Checking background service...")).toBeNull()
    );
    expect(screen.queryByText(/Background service installed/)).toBeNull();
  });

  it("offers to install the background service when the agents are missing", async () => {
    renderBadge({
      platform: "darwin",
      supported: true,
      serverAgentInstalled: false,
      tickAgentInstalled: false,
      schedulerEnabled: true,
    });

    await waitFor(() =>
      expect(screen.getByText("Background service not installed: runs only while app server is up")).toBeTruthy()
    );
    expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
  });

  it("renders nothing when the CLI manages the server and the tick agent is installed", async () => {
    renderBadge({
      platform: "darwin",
      supported: true,
      serverAgentSupported: false,
      serverAgentInstalled: false,
      tickAgentInstalled: true,
      schedulerEnabled: true,
    });

    await waitFor(() =>
      expect(screen.queryByText("Checking background service...")).toBeNull()
    );
    expect(screen.queryByText(/Background service installed/)).toBeNull();
  });
});
