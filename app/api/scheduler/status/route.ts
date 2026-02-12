import { NextResponse } from "next/server";
import { getSchedulerStatus, startScheduler } from "@/lib/jobs/scheduler";

export async function GET() {
  try {
    // Ensure scheduler is started (server-side auto-init)
    await startScheduler();

    const status = await getSchedulerStatus();

    // Format dates for JSON serialization
    return NextResponse.json({
      isActive: status.isActive,
      lastRun: status.lastRun?.toISOString() || null,
      nextRun: status.nextRun?.toISOString() || null,
      frequencyHours: status.frequencyHours,
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
