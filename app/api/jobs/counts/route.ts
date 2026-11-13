import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { getJobStatusCounts } from "@/lib/application/jobs-service";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getJobStatusCounts());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch job counts", fallbackCode: "job_counts_fetch_failed" });
  }
}
