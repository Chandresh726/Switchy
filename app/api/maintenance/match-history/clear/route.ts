import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { clearMatchHistory } from "@/lib/application/maintenance-service";
import { assertAppRequest, handleApiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await clearMatchHistory());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to clear match history", fallbackCode: "match_history_clear_failed" });
  }
}
