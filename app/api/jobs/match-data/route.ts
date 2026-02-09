import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs, matchSessions, matchLogs } from "@/lib/db/schema";

/**
 * DELETE /api/jobs/match-data
 * Deletes all match sessions, match logs, and clears match data from jobs
 */
export async function DELETE() {
  try {
    // Delete all match logs first (due to foreign key constraint)
    await db.delete(matchLogs);

    // Delete all match sessions
    await db.delete(matchSessions);

    // Clear match fields from all jobs
    const result = await db
      .update(jobs)
      .set({
        matchScore: null,
        matchReasons: null,
        matchedSkills: null,
        missingSkills: null,
        recommendations: null,
        cleanDescription: null,
        updatedAt: new Date(),
      });

    // Get count of jobs that were updated
    const allJobs = await db.select({ id: jobs.id }).from(jobs);

    console.log(`[Match Data] Cleared match data from ${allJobs.length} jobs`);

    return NextResponse.json({
      success: true,
      jobsCleared: allJobs.length,
      message: `Cleared match data from ${allJobs.length} jobs`,
    });
  } catch (error) {
    console.error("[Match Data API] DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete match data" },
      { status: 500 }
    );
  }
}
