import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIError } from "@/lib/ai/shared/errors";

const mocks = vi.hoisted(() => ({
  getProviderValidationContext: vi.fn(),
  getLocalCLIStatus: vi.fn(),
  getProviderModels: vi.fn(),
  createModel: vi.fn(),
}));

vi.mock("@/lib/ai/providers/provider-service", () => ({
  getProviderValidationContext: mocks.getProviderValidationContext,
}));
vi.mock("@/lib/ai/local-cli/service", () => ({
  getLocalCLIStatus: mocks.getLocalCLIStatus,
}));
vi.mock("@/lib/ai/providers/model-catalog", () => ({
  getProviderModels: mocks.getProviderModels,
}));
vi.mock("@/lib/ai/providers", () => ({
  providerRegistry: { get: vi.fn(() => ({ requiresApiKey: false, createModel: mocks.createModel })) },
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

  it("validates custom providers through model discovery without constructing or generating a model", async () => {
    mocks.getProviderValidationContext.mockResolvedValue({
      provider: { id: "custom-1", provider: "custom", apiKey: null },
      providerType: "custom",
    });
    mocks.getProviderModels.mockResolvedValue({
      models: [{ modelId: "proxy-model" }, { modelId: "manual-model" }],
    });
    const request = new Request("http://localhost/api/providers/custom-1/validate", {
      method: "POST",
      headers: { origin: "http://localhost", "x-switchy-request": "true" },
    }) as NextRequest;

    const response = await POST(request, {
      params: Promise.resolve({ id: "custom-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      valid: true,
      provider: "custom",
      modelsCount: 2,
    });
    expect(mocks.createModel).not.toHaveBeenCalled();
    expect(mocks.getProviderModels).toHaveBeenCalledWith("custom-1", {
      forceRefresh: true,
      allowStaleOnError: false,
    });
  });

  it("does not expose credentials when live custom validation fails", async () => {
    mocks.getProviderValidationContext.mockResolvedValue({
      provider: { id: "custom-1", provider: "custom", apiKey: "encrypted" },
      providerType: "custom",
    });
    mocks.getProviderModels.mockRejectedValue(new Error(
      "Upstream echoed proxy-secret and header-secret"
    ));
    const request = new Request("http://localhost/api/providers/custom-1/validate", {
      method: "POST",
      headers: { origin: "http://localhost", "x-switchy-request": "true" },
    }) as NextRequest;

    const response = await POST(request, {
      params: Promise.resolve({ id: "custom-1" }),
    });
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).not.toContain("proxy-secret");
    expect(serialized).not.toContain("header-secret");
  });

  it("returns the timeout-specific API response when custom model discovery times out", async () => {
    mocks.getProviderValidationContext.mockResolvedValue({
      provider: { id: "custom-1", provider: "custom", apiKey: null },
      providerType: "custom",
    });
    mocks.getProviderModels.mockRejectedValue(new AIError({
      type: "timeout",
      message: "Custom provider model discovery timed out",
    }));
    const request = new Request("http://localhost/api/providers/custom-1/validate", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "x-switchy-request": "true",
        "x-request-id": "custom-timeout-1",
      },
    }) as NextRequest;

    const response = await POST(request, {
      params: Promise.resolve({ id: "custom-1" }),
    });

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      error: "The AI request timed out.",
      code: "ai_timeout",
      requestId: "custom-timeout-1",
    });
  });
});
