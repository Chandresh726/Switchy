import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { unmatchedCompaniesQuerySchema } from "@/lib/api/contracts/people";
import { listIgnoredUnmatchedCompanies } from "@/lib/application/people-service";

export async function GET(request: NextRequest) {
  try {
    const query = unmatchedCompaniesQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listIgnoredUnmatchedCompanies(query));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch ignored companies", fallbackCode: "ignored_companies_fetch_failed" });
  }
}
