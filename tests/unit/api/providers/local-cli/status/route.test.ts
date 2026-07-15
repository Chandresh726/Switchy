import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLocalCLIStatus: vi.fn(),
}));

vi.mock("@/lib/ai/local-cli/service", () => ({
  getLocalCLIStatus: mocks.getLocalCLIStatus,
}));

import { GET } from "@/app/api/providers/local-cli/status/route";

describe("GET /api/providers/local-cli/status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks a selected local CLI without creating a provider record", async () => {
    mocks.getLocalCLIStatus.mockResolvedValue({
      status: "ready",
      selectable: true,
      cliVersion: "1.2.3",
      statusMessage: "2 text models available.",
      lastCheckedAt: "2026-07-15T00:00:00.000Z",
    });

    const response = await GET(new NextRequest(
      "http://localhost/api/providers/local-cli/status?provider=codex_cli"
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready", selectable: true });
    expect(mocks.getLocalCLIStatus).toHaveBeenCalledWith("codex_cli", { forceRefresh: true });
  });

  it("rejects non-CLI provider identifiers", async () => {
    const response = await GET(new NextRequest(
      "http://localhost/api/providers/local-cli/status?provider=openai"
    ));

    expect(response.status).toBe(400);
    expect(mocks.getLocalCLIStatus).not.toHaveBeenCalled();
  });
});
