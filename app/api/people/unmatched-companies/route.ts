import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { unmatchedCompaniesQuerySchema, unmatchedCompanyPatchBodySchema } from "@/lib/api/contracts/people";
import { listUnmatchedCompanies, updateUnmatchedCompany } from "@/lib/application/people-service";

export async function GET(request: NextRequest) {
  try {
    const query = unmatchedCompaniesQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return NextResponse.json(await listUnmatchedCompanies(query));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch unmatched companies", fallbackCode: "unmatched_companies_fetch_failed" });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);
    const command = unmatchedCompanyPatchBodySchema.parse(await request.json());
    return NextResponse.json(await updateUnmatchedCompany(command));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update unmatched companies", fallbackCode: "unmatched_companies_update_failed" });
  }
}
