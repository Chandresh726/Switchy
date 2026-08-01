import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getResumeParseHistoryDetail } from "@/lib/ai/observability";
import { handleApiError, NotFoundError } from "@/lib/api";
import { resumeHistoryIdParamsSchema } from "@/lib/api/contracts/history";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = resumeHistoryIdParamsSchema.parse(await params);
    const detail = await getResumeParseHistoryDetail(id);
    if (!detail) {
      throw new NotFoundError(
        "Resume history entry not found",
        "resume_history_entry_not_found"
      );
    }
    return NextResponse.json(detail, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, {
      request,
      fallbackMessage: "Failed to fetch resume parse details",
      fallbackCode: "resume_history_detail_fetch_failed",
      headers: NO_STORE_HEADERS,
    });
  }
}
