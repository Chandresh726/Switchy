import { NextResponse } from "next/server";

import { getAIUsageSummary, parseAIUsageDays } from "@/lib/ai/observability";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request) {
  try {
    const days = parseAIUsageDays(new URL(request.url).searchParams.get("days"));
    return NextResponse.json(await getAIUsageSummary(days), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[AI Usage API] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch AI usage" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
