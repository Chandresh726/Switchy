import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api";
import { unmatchedCompanyPeopleQuerySchema } from "@/lib/api/contracts/people";
import { listUnmatchedCompanyPeople } from "@/lib/application/people-service";

export async function GET(request: NextRequest) {
  try {
    const query = unmatchedCompanyPeopleQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listUnmatchedCompanyPeople(query));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch unmatched company people", fallbackCode: "unmatched_company_people_fetch_failed" });
  }
}
