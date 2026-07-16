import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  toProviderPublic: vi.fn((provider: { id: string; provider: string }) => ({
    id: provider.id,
    provider: provider.provider,
    kind: provider.provider.endsWith("_cli") ? "local_cli" : "api_key",
    selectable: true,
  })),
  getCachedLocalCLIStatus: vi.fn(),
  getLocalCLIStatus: vi.fn(),
}));

vi.mock("@/lib/ai/providers/provider-service", () => ({
  createProvider: vi.fn(),
  listProviders: mocks.listProviders,
  toProviderPublic: mocks.toProviderPublic,
}));

vi.mock("@/lib/ai/local-cli/service", () => ({
  getCachedLocalCLIStatus: mocks.getCachedLocalCLIStatus,
  getLocalCLIStatus: mocks.getLocalCLIStatus,
}));

import { GET } from "@/app/api/providers/route";

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
    const response = await GET();
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

    const response = await GET();
    const body = await response.json();

    expect(mocks.getLocalCLIStatus).not.toHaveBeenCalled();
    expect(body[0]).toMatchObject({
      connectionStatus: "not_authenticated",
      selectable: false,
    });
  });
});
