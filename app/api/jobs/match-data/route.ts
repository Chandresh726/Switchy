import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { clearMatchData } from "@/lib/application/maintenance-service";

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await clearMatchData());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete match data", fallbackCode: "match_data_delete_failed" });
  }
}
