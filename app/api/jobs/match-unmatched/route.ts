import { NextResponse } from "next/server";
import { getUnmatchedJobIds, matchWithTracking } from "@/lib/ai/matcher";

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

export async function POST() {
  try {
    const unmatchedJobIds = await getUnmatchedJobIds();

    if (unmatchedJobIds.length === 0) {
      return NextResponse.json({
        success: true,
        sessionId: "",
        total: 0,
        matched: 0,
        failed: 0,
      });
    }

    const result = await matchWithTracking(unmatchedJobIds, {
      triggerSource: "manual",
    });

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
