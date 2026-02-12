import { NextResponse } from "next/server";
import { startScheduler, restartScheduler, getSchedulerStatus } from "@/lib/jobs/scheduler";

export async function POST() {
  try {
    // Check current status first
    const currentStatus = await getSchedulerStatus();

    if (currentStatus.isActive) {
      // If already active, restart with new settings
      await restartScheduler();
    } else {
      // Start fresh
      await startScheduler();
    }

    // Get updated status
    const newStatus = await getSchedulerStatus();

    return NextResponse.json({
      success: true,
      isActive: newStatus.isActive,
      lastRun: newStatus.lastRun?.toISOString() || null,
      nextRun: newStatus.nextRun?.toISOString() || null,
      frequencyHours: newStatus.frequencyHours,
      cronExpression: newStatus.cronExpression,
      message: currentStatus.isActive ? "Scheduler restarted" : "Scheduler started",
    });
  } catch (error) {
    console.error("[Scheduler Start API] Error:", error);
    return NextResponse.json(
      { error: "Failed to start scheduler" },
      { status: 500 }
    );
  }
}
