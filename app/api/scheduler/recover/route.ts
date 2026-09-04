import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { assertAppRequest, createApiRequestContext, handleApiError, withRequestIdHeader } from "@/lib/api";
import { recoverMissedSchedulerRuns } from "@/lib/jobs/scheduler";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function POST(request: NextRequest) {
  const context = createApiRequestContext(request);
  try {
    assertAppRequest(request);

    const result = await recoverMissedSchedulerRuns(context.requestId);

    return NextResponse.json(result, { headers: withRequestIdHeader(NO_STORE_HEADERS, context) });
  } catch (error) {
    return handleApiError(error, { request, context, fallbackMessage: "Failed to recover missed scheduler runs", fallbackCode: "scheduler_recover_failed", headers: NO_STORE_HEADERS });
  }
}
