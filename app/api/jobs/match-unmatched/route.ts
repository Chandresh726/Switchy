import { NextResponse } from "next/server";

import { MatchUnmatchedQuerySchema } from "@/lib/ai/contracts";
import {
  createMatchSession,
  getMatchSessionStatus,
  getUnmatchedJobIds,
  matchWithTracking,
} from "@/lib/ai/matcher";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = MatchUnmatchedQuerySchema.parse({
      sessionId: searchParams.get("sessionId") ?? undefined,
    });

    if (query.sessionId) {
      const session = await getMatchSessionStatus(query.sessionId);
      if (!session) {
        return NextResponse.json(
          { error: "Session not found", code: "session_not_found" },
          { status: 404, headers: NO_STORE_HEADERS }
        );
      }

      return NextResponse.json(
        {
          sessionId: session.id,
          status: session.status,
          total: session.jobsTotal,
          completed: session.jobsCompleted,
          succeeded: session.jobsSucceeded,
          failed: session.jobsFailed,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    const unmatchedJobIds = await getUnmatchedJobIds();
    return NextResponse.json({ count: unmatchedJobIds.length }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleAIAPIError(
      error,
      "Failed to get unmatched job count",
      "match_unmatched_get_failed",
      NO_STORE_HEADERS
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
    }).catch((error) => {
      console.error("[Match Unmatched] Background matching failed:", error);
    });

    return NextResponse.json({
      success: true,
      sessionId,
      total: unmatchedJobIds.length,
      matched: 0,
      failed: 0,
    });
  } catch (error) {
    return handleAIAPIError(error, "Failed to start matching", "match_unmatched_post_failed");
  }
}
