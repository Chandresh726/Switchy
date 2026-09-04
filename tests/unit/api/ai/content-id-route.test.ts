import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteGeneratedContent: vi.fn(),
  saveManualVariant: vi.fn(),
}));

vi.mock("@/lib/ai/writing/content-service", () => ({
  deleteGeneratedContent: mocks.deleteGeneratedContent,
  saveManualVariant: mocks.saveManualVariant,
}));

import { DELETE } from "@/app/api/ai/content/[id]/route";

describe("DELETE /api/ai/content/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteGeneratedContent.mockResolvedValue(false);
  });

  it("returns 404 when generated content does not exist", async () => {
    const request = new Request("http://localhost/api/ai/content/99", {
      method: "DELETE",
      headers: {
        origin: "http://localhost",
        "x-switchy-request": "true",
      },
    }) as NextRequest;

    const response = await DELETE(request, {
      params: Promise.resolve({ id: "99" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "ai_content_not_found",
      requestId: expect.any(String),
    });
  });
});
