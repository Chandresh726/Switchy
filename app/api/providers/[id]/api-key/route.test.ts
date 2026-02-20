import { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProviderById: vi.fn(),
  decryptProviderApiKey: vi.fn(),
}));

vi.mock("@/lib/ai/providers/provider-service", () => ({
  requireProviderById: mocks.requireProviderById,
  decryptProviderApiKey: mocks.decryptProviderApiKey,
}));

import { GET } from "@/app/api/providers/[id]/api-key/route";

describe("GET /api/providers/[id]/api-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects cross-origin requests", async () => {
    const request = new NextRequest("http://localhost/api/providers/provider-1/api-key", {
      headers: {
        origin: "http://evil.example.com",
      },
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: "provider-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: "Cross-origin requests are not allowed",
      code: "cross_origin_forbidden",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.requireProviderById).not.toHaveBeenCalled();
  });

  it("returns API key for same-origin request with strict no-cache headers", async () => {
    mocks.requireProviderById.mockResolvedValue({
      id: "provider-1",
      provider: "openai",
      apiKey: "encrypted",
      isActive: true,
      isDefault: true,
      createdAt: new Date("2026-02-20T00:00:00.000Z"),
      updatedAt: new Date("2026-02-20T00:00:00.000Z"),
    });
    mocks.decryptProviderApiKey.mockReturnValue("sk-live");

    const request = new NextRequest("http://localhost/api/providers/provider-1/api-key", {
      headers: {
        origin: "http://localhost",
      },
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: "provider-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.apiKey).toBe("sk-live");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });
});
