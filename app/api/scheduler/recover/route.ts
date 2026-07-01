import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { assertAppRequest } from "@/lib/api";
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
    console.error("[Scheduler Recover API] Error:", error);
    return NextResponse.json(
      { error: "Failed to recover missed scheduler runs", code: "scheduler_recover_failed" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
