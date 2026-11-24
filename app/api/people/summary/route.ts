import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { withApiTiming } from "@/lib/api/timing";
import { getPeopleSummary } from "@/lib/application/people-service";

export async function GET(request: Request) {
  return withApiTiming(async () => {
    try {
      return NextResponse.json(await getPeopleSummary());
    } catch (error) {
      return handleApiError(error, { request, fallbackMessage: "Failed to fetch people summary", fallbackCode: "people_summary_failed" });
    }
  });
}
