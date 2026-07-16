import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { getRuntimeHealth } from "@/lib/runtime/health";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request) {
  try {
    return NextResponse.json(await getRuntimeHealth(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Runtime health check failed",
      fallbackCode: "runtime_health_check_failed",
      headers: NO_STORE_HEADERS,
    });
  }
}
