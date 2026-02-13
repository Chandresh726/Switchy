import { NextResponse } from "next/server";
import { startScheduler, restartScheduler, getSchedulerStatus } from "@/lib/jobs/scheduler";

export async function POST() {
  try {
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
