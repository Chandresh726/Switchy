import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderValidationContext: vi.fn(),
  getLocalCLIStatus: vi.fn(),
}));

vi.mock("@/lib/ai/providers/provider-service", () => ({
  getProviderValidationContext: mocks.getProviderValidationContext,
}));
vi.mock("@/lib/ai/local-cli/service", () => ({
  getLocalCLIStatus: mocks.getLocalCLIStatus,
}));
vi.mock("@/lib/ai/providers/model-catalog", () => ({
  getProviderModels: vi.fn(),
}));
vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: { get: vi.fn() },
}));

import { POST } from "@/app/api/providers/[id]/validate/route";

describe("POST /api/providers/[id]/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderValidationContext.mockResolvedValue({
      provider: { id: "local-1", provider: "codex_cli" },
      providerType: "codex_cli",
      decryptedApiKey: null,
    });
  });

  it("uses the standard correlated error envelope when a local provider is unavailable", async () => {
    mocks.getLocalCLIStatus.mockResolvedValue({
      selectable: false,
      status: "not_installed",
      statusMessage: "Provider is not installed",
    });
    const request = new Request("http://localhost/api/providers/local-1/validate", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "x-switchy-request": "true",
        "x-request-id": "provider-request-1",
      },
    }) as NextRequest;

    const response = await POST(request, {
      params: Promise.resolve({ id: "local-1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Provider is not installed",
      code: "provider_not_ready",
      requestId: "provider-request-1",
      details: {
        provider: "codex_cli",
        connectionStatus: "not_installed",
      },
    });
    expect(response.headers.get("x-request-id")).toBe("provider-request-1");
  });
});
