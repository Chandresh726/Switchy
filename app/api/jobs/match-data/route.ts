import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { inArray } from "drizzle-orm";

import { assertAppRequest } from "@/lib/api";
import { db } from "@/lib/db";
import {
  jobs,
  matchSessions,
  scrapeMatchOutbox,
  scrapingLogs,
} from "@/lib/db/schema";

/**
 * DELETE /api/jobs/match-data
 * Deletes all match sessions, match logs, and clears match data from jobs
 */
export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    db.transaction((tx) => {
      const outboxes = tx
        .select({ scrapingLogId: scrapeMatchOutbox.scrapingLogId })
        .from(scrapeMatchOutbox)
        .all();
      const scrapingLogIds = outboxes.map((outbox) => outbox.scrapingLogId);
      if (scrapingLogIds.length > 0) {
        tx.update(scrapingLogs)
          .set({
            matcherStatus: null,
            matcherJobsTotal: null,
            matcherJobsCompleted: 0,
            matcherDuration: null,
            matcherErrorCount: 0,
          })
          .where(inArray(scrapingLogs.id, scrapingLogIds))
          .run();
      }

      tx.delete(matchSessions).run();
      tx.update(jobs)
        .set({
          matchScore: null,
          matchReasons: null,
          matchedSkills: null,
          missingSkills: null,
          recommendations: null,
          updatedAt: new Date(),
        })
        .run();
    }, { behavior: "immediate" });

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
