import { NextRequest, NextResponse } from "next/server";

import { MatchRouteBodySchema } from "@/lib/ai/contracts";
import { queueMatchWork } from "@/lib/ai/work-items";
import { assertAppRequest } from "@/lib/api";
import { handleAIAPIError } from "@/lib/api/ai-error-handler";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const body = MatchRouteBodySchema.parse(await request.json());
    const jobIds = "jobId" in body ? [body.jobId] : body.jobIds;
    const queued = queueMatchWork({ jobIds, triggerSource: "manual" });
    return NextResponse.json(queued, { status: 202 });
  } catch (error) {
    return handleAIAPIError(error, "Failed to queue match", "match_failed");
  }
}
