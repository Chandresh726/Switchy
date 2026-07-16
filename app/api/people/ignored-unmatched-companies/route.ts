import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { unmatchedCompaniesQuerySchema } from "@/lib/api/contracts/people";
import { getIgnoredUnmatchedCompaniesList } from "@/lib/people/sync";

export async function GET(request: NextRequest) {
  try {
    const query = unmatchedCompaniesQuerySchema.parse({
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
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch ignored companies", fallbackCode: "ignored_companies_fetch_failed" });
  }
}
