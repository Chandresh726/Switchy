import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";

import { assertAppRequest } from "@/lib/api";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";

export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = await request.json();
    const { companyIds } = body as { companyIds: number[] };

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return NextResponse.json(
        { error: "companyIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const { deletedJobs, deletedCompanies } =
      await getLocalDataMaintenanceService().deleteCompanies(companyIds);

    return NextResponse.json({
      success: true,
      deletedCompanies,
      deletedJobs,
      message: `Deleted ${deletedCompanies} companies and ${deletedJobs} jobs`,
    });
  } catch (error) {
    console.error("Failed to delete companies:", error);
    return NextResponse.json(
      { error: "Failed to delete companies" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = await request.json();
    const { companyIds, isActive } = body as {
      companyIds: number[];
      isActive: boolean;
    };

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return NextResponse.json(
        { error: "companyIds must be a non-empty array" },
        { status: 400 }
      );
    }

    if (typeof isActive !== "boolean") {
      return NextResponse.json(
        { error: "isActive must be a boolean" },
        { status: 400 }
      );
    }

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
    console.error("Failed to update companies:", error);
    return NextResponse.json(
      { error: "Failed to update companies" },
      { status: 500 }
    );
  }
}
