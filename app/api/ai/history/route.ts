import { NextRequest, NextResponse } from "next/server";

import {
  clearWritingHistory,
  getWritingHistoryContents,
} from "@/lib/ai/observability";
import { assertAppRequest } from "@/lib/api";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET() {
  try {
    return NextResponse.json(
      { contents: await getWritingHistoryContents() },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[Get AI History] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    clearWritingHistory();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Delete AI History] Error:", error);
    return NextResponse.json({ error: "Failed to clear AI history" }, { status: 500 });
  }
}
