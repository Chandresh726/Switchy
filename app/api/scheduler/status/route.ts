import { NextResponse } from "next/server";
import { handleApiError } from "@/lib/api";
import { getSchedulerStatus } from "@/lib/jobs/scheduler";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request) {
  try {
    const status = await getSchedulerStatus();

    return NextResponse.json({
      isActive: status.isActive,
      isRunning: status.isRunning,
      isEnabled: status.isEnabled,
      lastRun: status.lastRun?.toISOString() || null,
      nextRun: status.nextRun?.toISOString() || null,
      cronExpression: status.cronExpression,
      pendingMissedCount: status.pendingMissedCount,
      oldestMissedRun: status.oldestMissedRun?.toISOString() || null,
      latestMissedRun: status.latestMissedRun?.toISOString() || null,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to get scheduler status", fallbackCode: "scheduler_status_failed", headers: NO_STORE_HEADERS });
  }
}
