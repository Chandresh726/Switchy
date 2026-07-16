import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { clearPeople } from "@/lib/application/maintenance-service";
import { assertAppRequest, handleApiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await clearPeople());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to clear people", fallbackCode: "people_clear_failed" });
  }
}
