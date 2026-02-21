import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleApiError } from "@/lib/api";
import { getIgnoredUnmatchedCompaniesList } from "@/lib/connections/sync";

const QuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export async function GET(request: NextRequest) {
  try {
    const query = QuerySchema.parse({
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
    });

    const result = await getIgnoredUnmatchedCompaniesList({
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
