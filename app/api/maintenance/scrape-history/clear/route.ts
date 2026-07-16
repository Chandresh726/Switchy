import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { clearScrapeHistory } from "@/lib/application/maintenance-service";
import { assertAppRequest, handleApiError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    return NextResponse.json(await clearScrapeHistory());
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to clear scrape history", fallbackCode: "scrape_history_clear_failed" });
  }
}
