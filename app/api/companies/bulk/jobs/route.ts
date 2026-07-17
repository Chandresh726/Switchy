import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { companyIdsBodySchema } from "@/lib/api/contracts/companies";
import { deleteBulkCompanyJobs } from "@/lib/application/companies-service";

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);
    const { companyIds } = companyIdsBodySchema.parse(await request.json());
    return NextResponse.json(await deleteBulkCompanyJobs(companyIds));
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete jobs", fallbackCode: "company_jobs_bulk_delete_failed" });
  }
}
