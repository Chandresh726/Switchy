import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  recoverMissedSchedulerRuns: vi.fn(),
}));

vi.mock("@/lib/jobs/scheduler", () => ({
  recoverMissedSchedulerRuns: mocks.recoverMissedSchedulerRuns,
}));

import { POST } from "@/app/api/scheduler/recover/route";

describe("scheduler recover route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recovery status", async () => {
    mocks.recoverMissedSchedulerRuns.mockResolvedValue({
      status: "started",
      pendingMissedCount: 0,
      oldestMissedRun: null,
      latestMissedRun: null,
    });

    const response = await POST(new Request("http://localhost/api/scheduler/recover", {
      headers: {
        origin: "http://localhost",
        "x-switchy-request": "true",
      },
    }) as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("started");
  });
});
