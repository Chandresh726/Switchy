import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  clearWritingHistory: vi.fn(),
  getWritingHistoryContents: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: mocks.assertAppRequest,
}));

vi.mock("@/lib/ai/observability", () => ({
  clearWritingHistory: mocks.clearWritingHistory,
  getWritingHistoryContents: mocks.getWritingHistoryContents,
}));

import { DELETE, GET } from "@/app/api/ai/history/route";

describe("AI history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns writing history without allowing response caching", async () => {
    mocks.getWritingHistoryContents.mockResolvedValue([{ id: 1, history: [] }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.contents).toEqual([{ id: 1, history: [] }]);
  });

  it("authorizes and clears writing history through the repository", async () => {
    const request = new Request("http://localhost/api/ai/history", {
      method: "DELETE",
    }) as NextRequest;

    const response = await DELETE(request);

    expect(response.status).toBe(200);
    expect(mocks.assertAppRequest).toHaveBeenCalledWith(request);
    expect(mocks.clearWritingHistory).toHaveBeenCalledOnce();
  });
});
