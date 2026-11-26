import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useSettingsProviders } from "@/components/settings/use-settings-providers";
import { queryKeys } from "@/lib/query-keys";

const mocks = vi.hoisted(() => ({
  getProviders: vi.fn(), getLocalCLIStatus: vi.fn(), getProviderModels: vi.fn(),
  checkProviderConnection: vi.fn(), patchSettings: vi.fn(), error: vi.fn(),
}));
vi.mock("@/lib/api/clients/providers", () => ({
  getProviders: mocks.getProviders, getLocalCLIStatus: mocks.getLocalCLIStatus,
  getProviderModels: mocks.getProviderModels, checkProviderConnection: mocks.checkProviderConnection,
  createProvider: vi.fn(), deleteProvider: vi.fn(), updateProvider: vi.fn(), updateProviderApiKey: vi.fn(),
}));
vi.mock("@/lib/api/clients/settings", () => ({ patchSettings: mocks.patchSettings }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: mocks.error } }));

const provider = {
  id: "builtin:codex-cli", provider: "codex_cli", kind: "local_cli", isActive: true,
  hasApiKey: false, selectable: true, connectionStatus: "ready", createdAt: null, updatedAt: null,
};
const models = [{ modelId: "saved-model", label: "Saved model", supportsReasoning: false }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderModels.mockResolvedValue({ models, source: "cache", fetchedAt: new Date().toISOString(), isStale: false });
  mocks.checkProviderConnection.mockResolvedValue({ valid: true, provider: "codex_cli" });
  mocks.getLocalCLIStatus.mockResolvedValue({ status: "ready", selectable: true, statusMessage: "Ready", lastCheckedAt: new Date().toISOString() });
});

function setup(record = provider) {
  const saved = { ...record, lastCheckedAt: new Date().toISOString() };
  mocks.getProviders.mockResolvedValue([saved]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(queryKeys.providers.list(), [saved]);
  return renderHook(() => useSettingsProviders(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

it("uses the existing refresh action to recover a CLI login without rediscovering models twice", async () => {
  const { result } = setup({ ...provider, connectionStatus: "not_authenticated", selectable: false });
  await waitFor(() => expect(result.current.providerModelsById[provider.id]?.models).toHaveLength(1));
  expect(result.current.providers[0].connectionStatus).toBe("not_authenticated");
  await act(async () => { await result.current.refreshProviderModels(provider.id); });
  expect(mocks.checkProviderConnection).toHaveBeenCalledExactlyOnceWith(provider.id);
  expect(mocks.getProviderModels).toHaveBeenCalledTimes(2);
  expect(mocks.getProviderModels.mock.calls.every(([, options]) => !options.refresh)).toBe(true);
  await waitFor(() => expect(result.current.providers[0].selectable).toBe(true));
  expect(mocks.patchSettings).not.toHaveBeenCalled();
});

it("retains saved models and updates CLI availability after a failed refresh", async () => {
  const { result } = setup();
  await waitFor(() => expect(result.current.providerModelsById[provider.id]?.models).toHaveLength(1));
  mocks.checkProviderConnection.mockRejectedValueOnce(new Error("CLI login expired"));
  mocks.getLocalCLIStatus.mockResolvedValue({ status: "not_authenticated", selectable: false, statusMessage: "CLI login expired", lastCheckedAt: new Date().toISOString() });
  await act(async () => { await result.current.refreshProviderModels(provider.id); });
  await waitFor(() => expect(result.current.providers[0].connectionStatus).toBe("not_authenticated"));
  expect(result.current.providerModelsById[provider.id].models).toEqual(models);
  expect(mocks.getProviderModels).toHaveBeenCalledTimes(1);
  expect(mocks.error).toHaveBeenCalledWith("CLI login expired");
  expect(mocks.patchSettings).not.toHaveBeenCalled();
});

it("refreshes API models directly without a separate connection check", async () => {
  const api = { ...provider, id: "api-provider", provider: "cerebras", kind: "api_key", hasApiKey: true };
  const { result } = setup(api);
  await waitFor(() => expect(result.current.providerModelsById[api.id]?.models).toHaveLength(1));
  await act(async () => { await result.current.refreshProviderModels(api.id); });
  expect(mocks.getProviderModels).toHaveBeenLastCalledWith(api.id, { refresh: "1" });
  expect(mocks.checkProviderConnection).not.toHaveBeenCalled();
  expect(mocks.patchSettings).not.toHaveBeenCalled();
});
