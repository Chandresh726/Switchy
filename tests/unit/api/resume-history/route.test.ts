import { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getResumeParseHistoryDetail: vi.fn(),
  getResumeParseHistory: vi.fn(),
}));

vi.mock("@/lib/ai/observability", () => ({
  getResumeParseHistoryDetail: mocks.getResumeParseHistoryDetail,
  getResumeParseHistory: mocks.getResumeParseHistory,
}));

import { GET as getDetail } from "@/app/api/resume-history/[id]/route";
import { GET } from "@/app/api/resume-history/route";

describe("resume history route", () => {
  beforeEach(() => {
    mocks.getResumeParseHistoryDetail.mockReset();
    mocks.getResumeParseHistory.mockReset();
    mocks.getResumeParseHistory.mockResolvedValue({
      entries: [],
      pagination: { total: 0, limit: 20, offset: 0, hasMore: false },
      stats: {
        totalUploads: 0,
        uploadOnly: 0,
        failedParses: 0,
        successRate: 0,
        avgDuration: 0,
        lastUploadAt: null,
      },
    });
  });

  it("validates pagination and returns a no-store response", async () => {
    const request = new NextRequest(
      "http://localhost/api/resume-history?limit=10&offset=20"
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.getResumeParseHistory).toHaveBeenCalledWith({
      limit: 10,
      offset: 20,
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects invalid pagination before querying history", async () => {
    const request = new NextRequest(
      "http://localhost/api/resume-history?limit=0"
    );

    const response = await GET(request);

    expect(response.status).toBe(400);
    expect(mocks.getResumeParseHistory).not.toHaveBeenCalled();
  });

  it("returns a directly addressed history entry", async () => {
    const detail = {
      entry: { id: "resume:1", fileName: "resume.pdf" },
      parsedData: { name: "Alex Rivera" },
    };
    mocks.getResumeParseHistoryDetail.mockResolvedValue(detail);
    const request = new NextRequest("http://localhost/api/resume-history/resume%3A1");

    const response = await getDetail(request, {
      params: Promise.resolve({ id: "resume%3A1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.getResumeParseHistoryDetail).toHaveBeenCalledWith("resume:1");
    await expect(response.json()).resolves.toEqual(detail);
  });

  it("returns 404 for a missing history entry", async () => {
    mocks.getResumeParseHistoryDetail.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/api/resume-history/run%3Amissing");

    const response = await getDetail(request, {
      params: Promise.resolve({ id: "run%3Amissing" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "resume_history_entry_not_found",
    });
  });
});
