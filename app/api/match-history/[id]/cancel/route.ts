import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { cancelMatchHistorySession } from "@/lib/application/history-service";
import { assertAppRequest, handleApiError } from "@/lib/api";
import { historyIdParamsSchema } from "@/lib/api/contracts/history";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = historyIdParamsSchema.parse(await params);
    return NextResponse.json(await cancelMatchHistorySession(id), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to cancel match session", fallbackCode: "match_session_stop_failed", headers: NO_STORE_HEADERS });
  }
}
