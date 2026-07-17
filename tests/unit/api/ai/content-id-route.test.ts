import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  delete: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { delete: mocks.delete } }));
vi.mock("@/lib/ai/writing/content-service", () => ({
  saveManualVariant: vi.fn(),
}));

import { DELETE } from "@/app/api/ai/content/[id]/route";

describe("DELETE /api/ai/content/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.delete
      .mockReturnValueOnce({ where: vi.fn().mockResolvedValue(undefined) })
      .mockReturnValueOnce({
        where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
      });
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
