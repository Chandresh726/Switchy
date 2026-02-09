import { NextResponse } from "next/server";
import { getUnmatchedJobIds, matchUnmatchedJobsWithTracking } from "@/lib/ai/matcher";

// GET - check how many jobs need matching
export async function GET() {
  try {
    const unmatchedJobIds = await getUnmatchedJobIds();

    return NextResponse.json({
      count: unmatchedJobIds.length,
    });
  } catch (error) {
    console.error("[Match Unmatched API] GET error:", error);
    return NextResponse.json(
      { error: "Failed to get unmatched job count" },
      { status: 500 }
    );
  }
}

// POST - run matcher on all unmatched jobs with session tracking
export async function POST() {
  try {
    const result = await matchUnmatchedJobsWithTracking(
      "manual",
      (completed, total, succeeded, failed) => {
        console.log(`[Match Unmatched API] Progress: ${completed}/${total} (${succeeded} succeeded, ${failed} failed)`);
      }
    );

    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      total: result.total,
      matched: result.succeeded,
      failed: result.failed,
    });
  } catch (error) {
    console.error("[Match Unmatched API] POST error:", error);
    return NextResponse.json(
      { error: "Failed to match unmatched jobs" },
      { status: 500 }
    );
  }
}
