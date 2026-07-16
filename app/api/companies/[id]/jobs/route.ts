import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest, handleApiError, NotFoundError } from "@/lib/api";
import { companyIdParamsSchema } from "@/lib/api/contracts/companies";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";
import { eq } from "drizzle-orm";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const { id: companyId } = companyIdParamsSchema.parse(await params);

    const company = await db.query.companies.findFirst({
      columns: { id: true },
      where: eq(companies.id, companyId),
    });
    if (!company) {
      throw new NotFoundError("Company not found", "company_not_found");
    }

    const deletedCount =
      await getLocalDataMaintenanceService().deleteCompanyJobs([companyId]);

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} job(s) for company ${companyId}`,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete jobs", fallbackCode: "company_jobs_delete_failed" });
  }
}
