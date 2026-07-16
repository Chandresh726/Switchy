import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { getReadinessHealth } from "@/lib/runtime/health";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request) {
  try {
    const health = await getReadinessHealth();
    return NextResponse.json(health, {
      status: health.ready ? 200 : 503,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Readiness check failed",
      fallbackCode: "readiness_check_failed",
      headers: NO_STORE_HEADERS,
    });
  }
}
