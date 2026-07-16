import { NextResponse } from "next/server";

import {
  MatchUnmatchedBodySchema,
  MatchUnmatchedQuerySchema,
} from "@/lib/ai/contracts";
import {
  getUnmatchedJobCount,
  getUnmatchedJobIds,
} from "@/lib/ai/matcher";
import {
  completeEmptyMatchSession,
  getAIWorkSession,
  queueMatchWork,
} from "@/lib/ai/work-items";
import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};
const DAY_MS = 24 * 60 * 60 * 1_000;

function getDiscoveryWindow(days: number): { discoveredSince: Date } {
  return { discoveredSince: new Date(Date.now() - days * DAY_MS) };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = MatchUnmatchedQuerySchema.parse({
      sessionId: searchParams.get("sessionId") ?? undefined,
      days: searchParams.get("days") ?? undefined,
    });

    if (query.sessionId) {
      const session = await getAIWorkSession(query.sessionId);
      if (!session) {
        throw new NotFoundError("Session not found", "session_not_found");
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

    const unmatchedJobCount = await getUnmatchedJobCount(getDiscoveryWindow(query.days));
    return NextResponse.json(
      { count: unmatchedJobCount, days: query.days },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to get unmatched job count",
      fallbackCode: "match_unmatched_get_failed",
      headers: NO_STORE_HEADERS,
    });
  }
}

export async function POST(request: Request) {
  try {
    assertAppRequest(request);
    const body = MatchUnmatchedBodySchema.parse(await request.json());

    const unmatchedJobIds = await getUnmatchedJobIds(getDiscoveryWindow(body.days));

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
    return handleApiError(error, { request, fallbackMessage: "Failed to start matching", fallbackCode: "match_unmatched_post_failed" });
  }
}
