import { NextResponse } from "next/server";
import { getSchedulerStatus } from "@/lib/jobs/scheduler";

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
    });
  } catch (error) {
    console.error("[Scheduler Status API] Error:", error);
    return NextResponse.json(
      { error: "Failed to get scheduler status" },
      { status: 500 }
    );
  }
}
