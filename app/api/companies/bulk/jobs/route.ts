import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest } from "@/lib/api";
import { deleteCompanyJobsAndTerminateWork } from "@/lib/scraper/matching";

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

    const deletedCount = deleteCompanyJobsAndTerminateWork(companyIds);

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} jobs from ${companyIds.length} companies`,
    });
  } catch (error) {
    console.error("Failed to delete jobs:", error);
    return NextResponse.json(
      { error: "Failed to delete jobs" },
      { status: 500 }
    );
  }
}
