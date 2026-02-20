import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContentByJobAndType: vi.fn(),
  generateContent: vi.fn(),
  clearAllGeneratedContent: vi.fn(),
}));

vi.mock("@/lib/ai/writing/content-service", () => ({
  getContentByJobAndType: mocks.getContentByJobAndType,
  generateContent: mocks.generateContent,
  clearAllGeneratedContent: mocks.clearAllGeneratedContent,
}));

import { DELETE, GET, POST } from "@/app/api/ai/content/route";

describe("POST /api/ai/content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 with typed code for invalid request payload", async () => {
    const request = new Request("http://localhost/api/ai/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "bad", type: "invalid-type" }),
    });

    const response = await POST(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("invalid_request");
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns existing content when query is valid", async () => {
    mocks.getContentByJobAndType.mockResolvedValue({
      id: 1,
      jobId: 42,
      type: "cover_letter",
      content: "hello",
      settingsSnapshot: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
    });

    const request = new Request("http://localhost/api/ai/content?jobId=42&type=cover_letter");
    const response = await GET(request as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.content.content).toBe("hello");
  });

  it("maps delete failures to typed internal error payload", async () => {
    mocks.clearAllGeneratedContent.mockRejectedValue(new Error("boom"));

    const response = await DELETE();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "boom",
      code: "ai_content_delete_all_failed",
    });
  });
});
