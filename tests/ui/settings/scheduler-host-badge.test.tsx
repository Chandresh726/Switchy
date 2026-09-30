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

  it("reports when the background service keeps scraping alive with UI closed", async () => {
    renderBadge({
      platform: "darwin",
      supported: true,
      serverAgentInstalled: true,
      tickAgentInstalled: true,
      schedulerEnabled: true,
    });

    await waitFor(() =>
      expect(screen.getByText("Background service installed: runs with UI closed")).toBeTruthy()
    );
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

  it("does not require the server agent when the CLI manages the server", async () => {
    renderBadge({
      platform: "darwin",
      supported: true,
      serverAgentSupported: false,
      serverAgentInstalled: false,
      tickAgentInstalled: true,
      schedulerEnabled: true,
    });

    await waitFor(() =>
      expect(screen.getByText("Background service installed: runs with UI closed")).toBeTruthy()
    );
  });
});
