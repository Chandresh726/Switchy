import type { NextRequest } from "next/server";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSchedulerStatus: vi.fn(),
  recoverMissedSchedulerRuns: vi.fn(),
}));

vi.mock("@/lib/jobs/scheduler", () => ({
  getSchedulerStatus: mocks.getSchedulerStatus,
  recoverMissedSchedulerRuns: mocks.recoverMissedSchedulerRuns,
}));

import { GET } from "@/app/api/scheduler/status/route";
import { POST } from "@/app/api/scheduler/recover/route";
import { schedulerRecoveryResponseSchema } from "@/lib/api/contracts/runtime";

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
    mocks.recoverMissedSchedulerRuns.mockResolvedValue({
      status: "not_needed",
      pendingMissedCount: 0,
      oldestMissedRun: null,
      latestMissedRun: null,
    });
  });

  it("returns scheduler status with recovery metadata", async () => {
    const response = await GET(
      new Request("http://localhost/api/scheduler/status")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pendingMissedCount).toBe(2);
    expect(body.oldestMissedRun).toBe("2026-04-05T00:00:00.000Z");
    expect(body.latestMissedRun).toBe("2026-04-05T03:00:00.000Z");
  });

  it("returns a client-valid scheduler recovery response", async () => {
    const response = await POST(new Request("http://localhost/api/scheduler/recover", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "x-switchy-request": "true",
      },
    }) as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(schedulerRecoveryResponseSchema.parse(body)).toEqual(body);
  });
});
