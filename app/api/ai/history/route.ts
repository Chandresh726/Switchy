import { NextRequest, NextResponse } from "next/server";

import {
  clearWritingHistory,
  getWritingHistoryContents,
} from "@/lib/ai/observability";
import { assertAppRequest, handleApiError } from "@/lib/api";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      { contents: await getWritingHistoryContents() },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch history", fallbackCode: "ai_history_fetch_failed", headers: NO_STORE_HEADERS });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    clearWritingHistory();

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to clear AI history", fallbackCode: "ai_history_clear_failed" });
  }
}
