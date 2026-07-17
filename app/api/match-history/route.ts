import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { historyQuerySchema } from "@/lib/api/contracts/history";
import { listMatchHistory } from "@/lib/application/history-service";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: NextRequest) {
  try {
    const { limit, offset } = historyQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listMatchHistory(limit, offset), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch match history", fallbackCode: "match_history_fetch_failed", headers: NO_STORE_HEADERS });
  }
}
