import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { companyIdsBodySchema } from "@/lib/api/contracts/companies";
import { refreshCompanyJobs } from "@/lib/application/companies-service";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);
    const { companyIds } = companyIdsBodySchema.parse(await request.json());
    return NextResponse.json(await refreshCompanyJobs(companyIds));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to refresh company jobs", fallbackCode: "company_jobs_refresh_failed" });
  }
}
