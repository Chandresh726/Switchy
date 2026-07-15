import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAIUsageSummary: vi.fn(),
}));

vi.mock("@/lib/ai/observability", () => ({
  getAIUsageSummary: mocks.getAIUsageSummary,
  parseAIUsageDays: (value: string | null) => value === "30" ? 30 : 7,
}));

import { GET } from "@/app/api/ai/usage/route";

describe("AI usage API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAIUsageSummary.mockResolvedValue({ days: 7, calls: 0 });
  });

  it("returns the selected local usage period without caching", async () => {
    mocks.getAIUsageSummary.mockResolvedValue({ days: 30, calls: 4 });

    const response = await GET(new Request("http://localhost/api/ai/usage?days=30"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ days: 30, calls: 4 });
    expect(mocks.getAIUsageSummary).toHaveBeenCalledWith(30);
  });

  it("defaults unsupported periods to seven days", async () => {
    await GET(new Request("http://localhost/api/ai/usage?days=365"));
    expect(mocks.getAIUsageSummary).toHaveBeenCalledWith(7);
  });
});
