import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertAppRequest, handleApiError } from "@/lib/api";
import { startScheduler, restartScheduler, getSchedulerStatus } from "@/lib/jobs/scheduler";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const currentStatus = await getSchedulerStatus();

    if (currentStatus.isActive) {
      await restartScheduler();
    } else {
      await startScheduler();
    }

    const newStatus = await getSchedulerStatus();

    return NextResponse.json({
      success: true,
      isActive: newStatus.isActive,
      lastRun: newStatus.lastRun?.toISOString() || null,
      nextRun: newStatus.nextRun?.toISOString() || null,
      cronExpression: newStatus.cronExpression,
      pendingMissedCount: newStatus.pendingMissedCount,
      oldestMissedRun: newStatus.oldestMissedRun?.toISOString() || null,
      latestMissedRun: newStatus.latestMissedRun?.toISOString() || null,
      message: currentStatus.isActive ? "Scheduler restarted" : "Scheduler started",
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to start scheduler", fallbackCode: "scheduler_start_failed" });
  }
}
