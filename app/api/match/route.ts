import { NextRequest, NextResponse } from "next/server";

import { MatchRouteBodySchema } from "@/lib/ai/contracts";
import { queueMatchWork } from "@/lib/ai/work-items";
import { assertAppRequest, handleApiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const body = MatchRouteBodySchema.parse(await request.json());
    const jobIds = "jobId" in body ? [body.jobId] : body.jobIds;
    const queued = queueMatchWork({ jobIds, triggerSource: "manual" });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to queue match",
      fallbackCode: "match_failed",
    });
  }
}
