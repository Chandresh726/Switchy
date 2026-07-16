import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";

import { assertAppRequest, handleApiError } from "@/lib/api";
import {
  companyBulkActiveBodySchema,
  companyIdsBodySchema,
} from "@/lib/api/contracts/companies";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { companyIds } = companyIdsBodySchema.parse(await request.json());

    const { deletedJobs, deletedCompanies } =
      await getLocalDataMaintenanceService().deleteCompanies(companyIds);

    return NextResponse.json({
      success: true,
      deletedCompanies,
      deletedJobs,
      message: `Deleted ${deletedCompanies} companies and ${deletedJobs} jobs`,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete companies", fallbackCode: "companies_bulk_delete_failed" });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);

    const { companyIds, isActive } = companyBulkActiveBodySchema.parse(await request.json());

    const updated = await db
      .update(companies)
      .set({ isActive, updatedAt: new Date() })
      .where(inArray(companies.id, companyIds))
      .returning({ id: companies.id });

    return NextResponse.json({
      success: true,
      updated: updated.length,
      message: `Updated ${updated.length} companies to ${isActive ? "active" : "paused"}`,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to update companies", fallbackCode: "companies_bulk_update_failed" });
  }
}
