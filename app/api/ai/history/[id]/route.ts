import { NextResponse } from "next/server";

import { getWritingHistoryContents } from "@/lib/ai/observability";
import { handleApiError, NotFoundError } from "@/lib/api";
import { numericIdParamsSchema } from "@/lib/api/contracts/matching";
import { db } from "@/lib/db";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = numericIdParamsSchema.parse(await params);
    const [content] = await getWritingHistoryContents(db, id);
    if (!content) throw new NotFoundError("Generated content not found", "content_not_found");
    return NextResponse.json({ exists: true, content }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch writing details", fallbackCode: "writing_details_failed" });
  }
}
