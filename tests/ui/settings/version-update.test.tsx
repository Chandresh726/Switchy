import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { SystemInfo } from "@/components/settings/system-info";
import { VersionUpdate } from "@/components/settings/version-update";
import { queryKeys } from "@/lib/query-keys";

const mocks = vi.hoisted(() => ({ status: vi.fn(), update: vi.fn(), success: vi.fn() }));
vi.mock("@/lib/api/clients/lifecycle", () => ({ getLifecycleStatus: mocks.status, requestLifecycleUpdate: mocks.update }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: vi.fn(), info: vi.fn(), loading: vi.fn() } }));

const initial = {
  supported: true, startupSupported: true,
  preferences: { startAtLogin: false, openAtLogin: false, automaticUpdates: false, consented: true, running: true, port: 6767 },
  update: { phase: "idle", latestVersion: null, lastCheckedAt: null, message: null, failedVersion: null, downloadedVersion: null },
};
function renderSystemInfo() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><SystemInfo version="1.0.0" dbPath="local" versionAction={<VersionUpdate version="1.0.0" />} /></QueryClientProvider>);
  return client;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue(initial);
  mocks.update.mockResolvedValue({ accepted: true });
});

it("checks for updates beside the existing version badge", async () => {
  renderSystemInfo();
  const button = await screen.findByRole("button", { name: "Check for updates" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  expect(screen.getByText("v1.0.0")).toBeTruthy();
  fireEvent.click(button);
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("check", expect.anything()));
});

it("downloads first, then offers restart and reports progress in toasts", async () => {
  const available = { ...initial, update: { ...initial.update, latestVersion: "2.0.0", phase: "available" } };
  mocks.status.mockResolvedValue(available);
  const client = renderSystemInfo();
  fireEvent.click(await screen.findByRole("button", { name: "Download update" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("download", expect.anything()));
  expect(mocks.update).not.toHaveBeenCalledWith("install", expect.anything());
  const ready = { ...available, update: { ...available.update, phase: "ready", downloadedVersion: "2.0.0" } };
  mocks.status.mockResolvedValue(ready);
  client.setQueryData(queryKeys.runtime.lifecycle(), ready);
  fireEvent.click(await screen.findByRole("button", { name: "Restart to update" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("install", expect.anything()));
  expect(mocks.success).toHaveBeenCalledWith("Downloaded. Restart to update.", expect.anything());
  expect(screen.queryByText("Downloaded. Restart to update.")).toBeNull();
});

it("explains why update actions are disabled in source builds", async () => {
  mocks.status.mockResolvedValue({ ...initial, supported: false, startupSupported: false });
  renderSystemInfo();
  const button = await screen.findByRole("button", { name: "Check for updates" });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(button.parentElement?.title).toBe("Update checks, downloads, and restarts require a packaged production build.");
  fireEvent.click(button);
  expect(mocks.update).not.toHaveBeenCalled();
});
