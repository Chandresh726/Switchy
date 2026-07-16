import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { recoverMissedSchedulerRuns } from "@/lib/jobs/scheduler";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const result = await recoverMissedSchedulerRuns();

    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to recover missed scheduler runs", fallbackCode: "scheduler_recover_failed", headers: NO_STORE_HEADERS });
  }
}
