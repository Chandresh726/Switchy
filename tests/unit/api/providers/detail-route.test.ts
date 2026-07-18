import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteProvider: vi.fn(),
  requireProviderById: vi.fn(),
  toProviderPublic: vi.fn(),
  updateProvider: vi.fn(),
}));

vi.mock("@/lib/ai/providers/provider-service", () => ({
  deleteProvider: mocks.deleteProvider,
  requireProviderById: mocks.requireProviderById,
  toProviderPublic: mocks.toProviderPublic,
  updateProvider: mocks.updateProvider,
}));

import { DELETE, GET, PATCH } from "@/app/api/providers/[id]/route";

describe("/api/providers/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireProviderById.mockResolvedValue({ id: "custom-1", provider: "custom" });
    mocks.toProviderPublic.mockReturnValue({
      id: "custom-1",
      provider: "custom",
      kind: "custom",
      displayName: "Local proxy",
      headerNames: ["Authorization"],
    });
    mocks.updateProvider.mockResolvedValue(undefined);
    mocks.deleteProvider.mockResolvedValue({ updatedFeatures: [] });
  });

  it("returns custom provider details without secret values", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/providers/custom-1"),
      { params: Promise.resolve({ id: "custom-1" }) }
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(serialized).toContain("Local proxy");
    expect(serialized).not.toContain("secret");
  });

  it("passes atomic custom connection updates while allowing stored secrets to be preserved", async () => {
    const body = {
      displayName: "Renamed proxy",
      apiFormat: "anthropic_messages",
      baseUrl: "http://127.0.0.1:8317/v1",
      headers: [
        { name: "Authorization" },
        { name: "X-Route", value: "replacement-secret" },
      ],
      manualModelIds: ["claude-model"],
    };
    const request = new NextRequest("http://localhost/api/providers/custom-1", {
      method: "PATCH",
      headers: { origin: "http://localhost", "x-switchy-request": "true" },
      body: JSON.stringify(body),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "custom-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateProvider).toHaveBeenCalledWith("custom-1", body);
    expect(JSON.stringify(await response.json())).not.toContain("replacement-secret");
  });

  it("sanitizes secret values when an update fails", async () => {
    mocks.updateProvider.mockRejectedValue(new Error(
      "Rejected replacement-secret and stored-secret"
    ));
    const request = new NextRequest("http://localhost/api/providers/custom-1", {
      method: "PATCH",
      headers: { origin: "http://localhost", "x-switchy-request": "true" },
      body: JSON.stringify({
        headers: [{ name: "X-Route", value: "replacement-secret" }],
      }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "custom-1" }),
    });
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(serialized).not.toContain("replacement-secret");
    expect(serialized).not.toContain("stored-secret");
  });

  it("deletes a custom provider through the shared lifecycle service", async () => {
    const request = new NextRequest("http://localhost/api/providers/custom-1", {
      method: "DELETE",
      headers: { origin: "http://localhost", "x-switchy-request": "true" },
    });

    const response = await DELETE(request, {
      params: Promise.resolve({ id: "custom-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      updatedFeatures: [],
    });
    expect(mocks.deleteProvider).toHaveBeenCalledWith("custom-1");
  });
});
