import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { unmatchedCompanyPeopleQuerySchema } from "@/lib/api/contracts/people";
import { getUnmatchedCompanyPersons } from "@/lib/people/sync";

export async function GET(request: NextRequest) {
  try {
    const query = unmatchedCompanyPeopleQuerySchema.parse({
      companyNormalized: request.nextUrl.searchParams.get("companyNormalized") ?? "",
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
      offset: request.nextUrl.searchParams.get("offset") ?? undefined,
    });

    const result = await getUnmatchedCompanyPersons({
      companyNormalized: query.companyNormalized,
      limit: query.limit,
      offset: query.offset,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch unmatched company people", fallbackCode: "unmatched_company_people_fetch_failed" });
  }
}
