import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest } from "@/lib/api";
import { deleteCompanyJobsAndTerminateWork } from "@/lib/scraper/matching";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertAppRequest(request);

    const { id } = await params;
    const companyId = parseInt(id);

    if (isNaN(companyId)) {
      return NextResponse.json(
        { error: "Invalid company ID" },
        { status: 400 }
      );
    }

    const deletedCount = deleteCompanyJobsAndTerminateWork([companyId]);

    return NextResponse.json({
      success: true,
      deletedCount,
      message: `Deleted ${deletedCount} job(s) for company ${companyId}`,
    });
  } catch (error) {
    console.error("Failed to delete company jobs:", error);
    return NextResponse.json(
      { error: "Failed to delete jobs" },
      { status: 500 }
    );
  }
}
