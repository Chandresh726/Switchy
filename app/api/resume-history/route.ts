import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getResumeParseHistory } from "@/lib/ai/observability";
import { handleApiError } from "@/lib/api";
import { resumeHistoryQuerySchema } from "@/lib/api/contracts/history";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: NextRequest) {
  try {
    const { limit, offset } = resumeHistoryQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    return NextResponse.json(
      await getResumeParseHistory({ limit, offset }),
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to fetch resume parse history",
      fallbackCode: "resume_history_fetch_failed",
      headers: NO_STORE_HEADERS,
    });
  }
}
