import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { ApplicationSettings } from "@/components/settings/application-settings";

const mocks = vi.hoisted(() => ({ status: vi.fn(), patch: vi.fn(), keepAwake: vi.fn() }));
vi.mock("@/lib/api/clients/lifecycle", () => ({
  getLifecycleStatus: mocks.status,
  patchLifecyclePreferences: mocks.patch,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const initial = {
  supported: true, startupSupported: true,
  preferences: { startAtLogin: false, openAtLogin: false, automaticUpdates: false, consented: false, running: true, port: 6767 },
  update: { phase: "idle", latestVersion: null, lastCheckedAt: null, message: null, failedVersion: null },
};
function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ApplicationSettings keepDeviceAwake={false} onKeepDeviceAwakeChange={mocks.keepAwake} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue(initial);
  mocks.patch.mockResolvedValue(initial);
});

it("keeps all four toggles in one card and saves them independently", async () => {
  renderSettings();
  const startup = await screen.findByRole("switch", { name: "Start Switchy on startup" });
  await waitFor(() => expect(startup.hasAttribute("disabled")).toBe(false));
  expect(screen.getAllByRole("switch")).toHaveLength(4);
  expect(screen.getByText("Display can sleep. Closing the lid still sleeps.")).toBeTruthy();
  expect(screen.getByText("Run after restarting your laptop.")).toBeTruthy();
  expect(screen.getByText("Open your browser when Switchy starts automatically.")).toBeTruthy();
  expect(screen.getByText("Update when work finishes and Switchy tabs are closed.")).toBeTruthy();
  const badge = screen.getByText("macOS");
  expect(badge.parentElement?.querySelector("label")?.textContent).toBe("Keep awake while scraping or matching");
  fireEvent.click(screen.getByRole("switch", { name: "Keep awake while scraping or matching" }));
  expect(mocks.keepAwake).toHaveBeenCalledWith(true);
  fireEvent.click(startup);
  await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith({ startAtLogin: true }, expect.anything()));
  await waitFor(() => expect(screen.getByRole("switch", { name: "Install updates automatically" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("switch", { name: "Install updates automatically" }));
  await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith({ automaticUpdates: true }, expect.anything()));
  expect(screen.queryByText(/Installed version/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
});

it("keeps the power toggle usable while lifecycle controls are disabled in development", async () => {
  mocks.status.mockResolvedValue({ ...initial, supported: false, startupSupported: false });
  renderSettings();
  await screen.findByText("Startup, power & updates");
  expect(screen.getByRole("switch", { name: "Keep awake while scraping or matching" }).hasAttribute("disabled")).toBe(false);
  for (const name of ["Start Switchy on startup", "Open Switchy on startup", "Install updates automatically"]) {
    expect(screen.getByRole("switch", { name }).hasAttribute("disabled")).toBe(true);
  }
});
