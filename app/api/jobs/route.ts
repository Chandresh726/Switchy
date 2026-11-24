import { withApiTiming } from "@/lib/api/timing";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { jobsQuerySchema } from "@/lib/api/contracts/jobs";
import { listJobs } from "@/lib/application/jobs-service";

export async function GET(request: NextRequest) {
  return withApiTiming(async () => {
  try {
    const query = jobsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json(await listJobs(query));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch jobs", fallbackCode: "jobs_fetch_failed" });
  }

  });
}
