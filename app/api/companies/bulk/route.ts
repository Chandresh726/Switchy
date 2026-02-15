import { db } from "@/lib/db";
import { companies, jobs } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyIds } = body as { companyIds: number[] };

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      return NextResponse.json(
        { error: "companyIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const deletedJobs = await db
      .delete(jobs)
      .where(inArray(jobs.companyId, companyIds))
      .returning({ id: jobs.id });

    const deletedCompanies = await db
      .delete(companies)
      .where(inArray(companies.id, companyIds))
      .returning({ id: companies.id });

    return NextResponse.json({
      success: true,
      deletedCompanies: deletedCompanies.length,
      deletedJobs: deletedJobs.length,
      message: `Deleted ${deletedCompanies.length} companies and ${deletedJobs.length} jobs`,
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
