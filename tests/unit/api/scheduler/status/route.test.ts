import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSchedulerStatus: vi.fn(),
}));

vi.mock("@/lib/jobs/scheduler", () => ({
  getSchedulerStatus: mocks.getSchedulerStatus,
}));

import { GET } from "@/app/api/scheduler/status/route";

describe("scheduler status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSchedulerStatus.mockResolvedValue({
      isActive: true,
      isRunning: false,
      isEnabled: true,
      lastRun: new Date("2026-04-05T06:00:00.000Z"),
      nextRun: new Date("2026-04-05T12:00:00.000Z"),
      cronExpression: "0 */6 * * *",
      pendingMissedCount: 2,
      oldestMissedRun: new Date("2026-04-05T00:00:00.000Z"),
      latestMissedRun: new Date("2026-04-05T03:00:00.000Z"),
    });
  });

  it("returns scheduler status with recovery metadata", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pendingMissedCount).toBe(2);
    expect(body.oldestMissedRun).toBe("2026-04-05T00:00:00.000Z");
    expect(body.latestMissedRun).toBe("2026-04-05T03:00:00.000Z");
  });
});
