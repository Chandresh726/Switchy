import { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
  getProviderModels: vi.fn(),
  listProviders: vi.fn(),
  toProviderPublic: vi.fn((provider: { id: string; provider: string }): Record<string, unknown> => ({
    id: provider.id,
    provider: provider.provider,
    kind: provider.provider === "custom"
      ? "custom"
      : provider.provider.endsWith("_cli") ? "local_cli" : "api_key",
    selectable: true,
  })),
  getCachedLocalCLIStatus: vi.fn(),
  getLocalCLIStatus: vi.fn(),
}));

vi.mock("@/lib/ai/providers/provider-service", () => ({
  createProvider: mocks.createProvider,
  listProviders: mocks.listProviders,
  toProviderPublic: mocks.toProviderPublic,
}));

vi.mock("@/lib/ai/providers/model-catalog", () => ({
  getProviderModels: mocks.getProviderModels,
}));

vi.mock("@/lib/settings/settings-service", () => ({ upsertSettings: vi.fn() }));

vi.mock("@/lib/ai/local-cli/service", () => ({
  getCachedLocalCLIStatus: mocks.getCachedLocalCLIStatus,
  getLocalCLIStatus: mocks.getLocalCLIStatus,
}));

import { GET, POST } from "@/app/api/providers/route";

describe("GET /api/providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProviders.mockResolvedValue([
      { id: "builtin:codex-cli", provider: "codex_cli" },
      { id: "provider-openai", provider: "openai" },
    ]);
    mocks.getCachedLocalCLIStatus.mockReturnValue(undefined);
    mocks.getLocalCLIStatus.mockResolvedValue({
      status: "ready",
      selectable: true,
      cliVersion: "1.2.3",
      statusMessage: "4 text models available.",
      lastCheckedAt: "2026-07-16T00:00:00.000Z",
    });
  });

  it("performs a non-generative status probe when startup warming has no result", async () => {
    const response = await GET(new NextRequest("http://localhost/api/providers"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getLocalCLIStatus).toHaveBeenCalledWith("codex_cli");
    expect(body[0]).toMatchObject({
      connectionStatus: "ready",
      selectable: true,
      cliVersion: "1.2.3",
    });
    expect(body[1]).not.toHaveProperty("connectionStatus");
  });

  it("uses a warmed status without probing again", async () => {
    mocks.getCachedLocalCLIStatus.mockReturnValue({
      status: "not_authenticated",
      selectable: false,
      statusMessage: "Codex CLI is installed but not logged in.",
      lastCheckedAt: "2026-07-16T00:00:00.000Z",
    });

    const response = await GET(new NextRequest("http://localhost/api/providers"));
    const body = await response.json();

    expect(mocks.getLocalCLIStatus).not.toHaveBeenCalled();
    expect(body[0]).toMatchObject({
      connectionStatus: "not_authenticated",
      selectable: false,
    });
  });

  it("lists multiple custom providers using sanitized public fields", async () => {
    mocks.listProviders.mockResolvedValue([
      { id: "custom-1", provider: "custom" },
      { id: "custom-2", provider: "custom" },
    ]);
    mocks.toProviderPublic
      .mockReturnValueOnce({
        id: "custom-1",
        provider: "custom",
        kind: "custom",
        displayName: "Primary proxy",
        headerNames: ["Authorization"],
      })
      .mockReturnValueOnce({
        id: "custom-2",
        provider: "custom",
        kind: "custom",
        displayName: "Backup proxy",
        headerNames: ["X-Route"],
      });

    const response = await GET(new NextRequest("http://localhost/api/providers"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body.map((provider: { displayName: string }) => provider.displayName))
      .toEqual(["Primary proxy", "Backup proxy"]);
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(mocks.getLocalCLIStatus).not.toHaveBeenCalled();
  });

  it("passes a complete custom connection to the service and returns no secrets", async () => {
    mocks.createProvider.mockResolvedValue({
      id: "custom-1",
      provider: "custom",
      isDefault: false,
    });
    mocks.toProviderPublic.mockReturnValueOnce({
      id: "custom-1",
      provider: "custom",
      kind: "custom",
      selectable: true,
      displayName: "Local proxy",
      baseUrl: "http://127.0.0.1:8317/v1",
      headerNames: ["X-Route"],
    });
    const request = new NextRequest("http://localhost/api/providers", {
      method: "POST",
      headers: { origin: "http://localhost", "x-switchy-request": "true" },
      body: JSON.stringify({
        provider: "custom",
        displayName: "Local proxy",
        apiFormat: "openai_chat_completions",
        baseUrl: "http://127.0.0.1:8317/v1",
        apiKey: "proxy-secret",
        headers: [{ name: "X-Route", value: "header-secret" }],
        manualModelIds: ["manual-model"],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createProvider).toHaveBeenCalledWith({
      provider: "custom",
      displayName: "Local proxy",
      apiFormat: "openai_chat_completions",
      baseUrl: "http://127.0.0.1:8317/v1",
      apiKey: "proxy-secret",
      headers: [{ name: "X-Route", value: "header-secret" }],
      manualModelIds: ["manual-model"],
    });
    expect(JSON.stringify(body)).not.toContain("proxy-secret");
    expect(JSON.stringify(body)).not.toContain("header-secret");
  });

  it("sanitizes credentials when custom provider creation fails", async () => {
    mocks.createProvider.mockRejectedValue(new Error(
      "Failed with proxy-secret and header-secret"
    ));
    const request = new NextRequest("http://localhost/api/providers", {
      method: "POST",
      headers: { origin: "http://localhost", "x-switchy-request": "true" },
      body: JSON.stringify({
        provider: "custom",
        displayName: "Local proxy",
        apiFormat: "openai_chat_completions",
        baseUrl: "http://127.0.0.1:8317/v1",
        apiKey: "proxy-secret",
        headers: [{ name: "X-Route", value: "header-secret" }],
      }),
    });

    const response = await POST(request);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).not.toContain("proxy-secret");
    expect(serialized).not.toContain("header-secret");
  });
});
