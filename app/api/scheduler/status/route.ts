import { NextResponse } from "next/server";
import { getSchedulerStatus } from "@/lib/jobs/scheduler";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET() {
  try {
    const status = await getSchedulerStatus();

    return NextResponse.json({
      isActive: status.isActive,
      isRunning: status.isRunning,
      isEnabled: status.isEnabled,
      lastRun: status.lastRun?.toISOString() || null,
      nextRun: status.nextRun?.toISOString() || null,
      cronExpression: status.cronExpression,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[Scheduler Status API] Error:", error);
    return NextResponse.json(
      { error: "Failed to get scheduler status" , code: "scheduler_status_failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
