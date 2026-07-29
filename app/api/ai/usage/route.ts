import { NextResponse } from "next/server";

import { getAIUsageSummary } from "@/lib/ai/observability";
import { handleApiError } from "@/lib/api";
import { aiUsageQuerySchema } from "@/lib/api/contracts/ai";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request) {
  try {
    const { days, group } = aiUsageQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    return NextResponse.json(await getAIUsageSummary(days, { group }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch AI usage", fallbackCode: "ai_usage_fetch_failed", headers: NO_STORE_HEADERS });
  }
}
