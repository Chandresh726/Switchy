import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { companyIdsBodySchema } from "@/lib/api/contracts/companies";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { companyIds } = companyIdsBodySchema.parse(await request.json());

    const deletedCount =
      await getLocalDataMaintenanceService().deleteCompanyJobs(companyIds);

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} jobs from ${companyIds.length} companies`,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete jobs", fallbackCode: "company_jobs_bulk_delete_failed" });
  }
}
