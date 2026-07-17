import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { scrapeHistoryQuerySchema } from "@/lib/api/contracts/history";
import { listScrapeHistory } from "@/lib/application/history-service";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: NextRequest) {
  try {
    const { limit, offset } = scrapeHistoryQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(listScrapeHistory(limit, offset), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch scrape history", fallbackCode: "scrape_history_fetch_failed", headers: NO_STORE_HEADERS });
  }
}
