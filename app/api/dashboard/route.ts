import { NextResponse } from "next/server";

import { createApiRequestContext, handleApiError } from "@/lib/api";
import { withApiTiming } from "@/lib/api/timing";
import { getDashboard } from "@/lib/application/dashboard-service";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request) {
  return withApiTiming(async () => {
    try {
      return NextResponse.json(await getDashboard(createApiRequestContext(request)), { headers: NO_STORE_HEADERS });
    } catch (error) {
      return handleApiError(error, { request, fallbackMessage: "Failed to fetch dashboard", fallbackCode: "dashboard_fetch_failed" });
    }
  });
}
