import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { historyIdParamsSchema } from "@/lib/api/contracts/history";
import { withApiTiming } from "@/lib/api/timing";
import { getScrapeSessionProgress } from "@/lib/application/session-progress";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiTiming(async () => {
    try {
      const { id } = historyIdParamsSchema.parse(await params);
      return NextResponse.json(await getScrapeSessionProgress(id), { headers: NO_STORE_HEADERS });
    } catch (error) {
      return handleApiError(error, { request, fallbackMessage: "Failed to read scrape progress", fallbackCode: "scrape_progress_failed" });
    }
  });
}
