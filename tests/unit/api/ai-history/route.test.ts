import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAppRequest: vi.fn(),
  clearWritingHistory: vi.fn(),
  getWritingHistoryPage: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  assertAppRequest: mocks.assertAppRequest,
}));

vi.mock("@/lib/ai/observability", () => ({
  clearWritingHistory: mocks.clearWritingHistory,
  getWritingHistoryPage: mocks.getWritingHistoryPage,
}));

import { DELETE, GET } from "@/app/api/ai/history/route";

describe("AI history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns writing history without allowing response caching", async () => {
    mocks.getWritingHistoryPage.mockResolvedValue({ contents: [{ id: 1 }], pagination: { total: 1, limit: 25, offset: 0, hasMore: false } });

    const response = await GET(
      new Request("http://localhost/api/ai/history") as NextRequest
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.contents).toEqual([{ id: 1 }]);
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
