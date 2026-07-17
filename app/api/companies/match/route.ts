import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { matchCompanyIdsBodySchema } from "@/lib/api/contracts/matching";
import { queueCompaniesMatch } from "@/lib/application/companies-service";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const { companyIds } = matchCompanyIdsBodySchema.parse(await request.json());
    return NextResponse.json(await queueCompaniesMatch(companyIds), { status: 202 });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to queue company matches", fallbackCode: "companies_match_failed" });
  }
}
