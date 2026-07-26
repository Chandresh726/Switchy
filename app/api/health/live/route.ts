import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { APP_VERSION } from "@/lib/constants";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request) {
  try {
    return NextResponse.json({
      status: "live",
      version: APP_VERSION,
      instanceId: process.env.SWITCHY_INSTANCE_ID ?? null,
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Liveness check failed",
      fallbackCode: "liveness_check_failed",
      headers: NO_STORE_HEADERS,
    });
  }
}
