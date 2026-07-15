import { NextResponse } from "next/server";

import { MatchUnmatchedQuerySchema } from "@/lib/ai/contracts";
import {
  getUnmatchedJobCount,
  getUnmatchedJobIds,
} from "@/lib/ai/matcher";
import {
  completeEmptyMatchSession,
  getAIWorkSession,
  queueMatchWork,
} from "@/lib/ai/work-items";
import { assertAppRequest } from "@/lib/api";
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
      const session = await getAIWorkSession(query.sessionId);
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

    const unmatchedJobCount = await getUnmatchedJobCount();
    return NextResponse.json({ count: unmatchedJobCount }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleAIAPIError(
      error,
      "Failed to get unmatched job count",
      "match_unmatched_get_failed",
      NO_STORE_HEADERS
    );
  }
}

export async function POST(request: Request) {
  try {
    assertAppRequest(request);

    const unmatchedJobIds = await getUnmatchedJobIds();

    if (unmatchedJobIds.length === 0) {
      return NextResponse.json(
        completeEmptyMatchSession({ triggerSource: "match_unmatched" }),
        { status: 202 }
      );
    }

    const queued = queueMatchWork({
      jobIds: unmatchedJobIds,
      triggerSource: "match_unmatched",
    });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    return handleAIAPIError(error, "Failed to start matching", "match_unmatched_post_failed");
  }
}
