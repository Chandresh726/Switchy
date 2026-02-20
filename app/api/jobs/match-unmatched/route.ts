import { NextResponse } from "next/server";
import { getUnmatchedJobIds, createMatchSession, matchWithTracking, getMatchSessionStatus } from "@/lib/ai/matcher";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (sessionId) {
      const session = await getMatchSessionStatus(sessionId);
      if (!session) {
        return NextResponse.json({ error: "Session not found" }, { status: 404, headers: NO_STORE_HEADERS });
      }
      return NextResponse.json({
        sessionId: session.id,
        status: session.status,
        total: session.jobsTotal,
        completed: session.jobsCompleted,
        succeeded: session.jobsSucceeded,
        failed: session.jobsFailed,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      }, { headers: NO_STORE_HEADERS });
    }

    const unmatchedJobIds = await getUnmatchedJobIds();
    return NextResponse.json({ count: unmatchedJobIds.length }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[Match Unmatched API] GET error:", error);
    return NextResponse.json(
      { error: "Failed to get unmatched job count" },
      { status: 500, headers: NO_STORE_HEADERS }
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

    const sessionId = await createMatchSession(unmatchedJobIds, "match_unmatched");

    matchWithTracking(unmatchedJobIds, {
      triggerSource: "match_unmatched",
      sessionId,
    }).catch((err) => {
      console.error("[Match Unmatched] Background matching failed:", err);
    });

    return NextResponse.json({
      success: true,
      sessionId,
      total: unmatchedJobIds.length,
      matched: 0,
      failed: 0,
    });
  } catch (error) {
    console.error("[Match Unmatched API] POST error:", error);
    return NextResponse.json(
      { error: "Failed to start matching" },
      { status: 500 }
    );
  }
}
