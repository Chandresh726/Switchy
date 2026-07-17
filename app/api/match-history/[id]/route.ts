import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  deleteMatchHistorySession,
  getMatchHistoryDetail,
} from "@/lib/application/history-service";
import { assertAppRequest, handleApiError } from "@/lib/api";
import { historyDetailQuerySchema, historyIdParamsSchema } from "@/lib/api/contracts/history";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

interface RouteContext { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = historyIdParamsSchema.parse(await params);
    const { logLimit, logOffset, workLimit, workOffset } = historyDetailQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    return NextResponse.json(await getMatchHistoryDetail(id, logLimit, logOffset, workLimit, workOffset), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch match session", fallbackCode: "match_history_fetch_failed", headers: NO_STORE_HEADERS });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    assertAppRequest(request);
    const { id } = historyIdParamsSchema.parse(await params);
    return NextResponse.json(await deleteMatchHistorySession(id), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete match session", fallbackCode: "match_history_delete_failed", headers: NO_STORE_HEADERS });
  }
}
