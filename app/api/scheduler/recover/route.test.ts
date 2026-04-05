import { beforeEach, describe, expect, it, vi } from "vitest";

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

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("started");
  });
});
