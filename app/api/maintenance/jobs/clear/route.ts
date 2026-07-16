import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { clearJobs } from "@/lib/application/maintenance-service";
import { assertAppRequest, handleApiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await clearJobs());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to clear jobs", fallbackCode: "jobs_clear_failed" });
  }
}
