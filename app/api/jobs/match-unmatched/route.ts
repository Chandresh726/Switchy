import { NextResponse } from "next/server";

import { MatchUnmatchedBodySchema, MatchUnmatchedQuerySchema } from "@/lib/ai/contracts";
import { assertAppRequest, handleApiError } from "@/lib/api";
import { getUnmatchedMatchStatus, queueUnmatchedJobs } from "@/lib/application/jobs-service";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET(request: Request) {
  try {
    const query = MatchUnmatchedQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await getUnmatchedMatchStatus(query.days, query.sessionId), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to get unmatched job count", fallbackCode: "match_unmatched_get_failed", headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: Request) {
  try {
    assertAppRequest(request);
    const { days } = MatchUnmatchedBodySchema.parse(await request.json());
    return NextResponse.json(await queueUnmatchedJobs(days), { status: 202 });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to start matching", fallbackCode: "match_unmatched_post_failed" });
  }
}
