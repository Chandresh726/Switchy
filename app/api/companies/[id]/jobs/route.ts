import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const companyId = parseInt(id);

    if (isNaN(companyId)) {
      return NextResponse.json(
        { error: "Invalid company ID" },
        { status: 400 }
      );
    }

    // Delete all jobs for this company
    const result = await db
      .delete(jobs)
      .where(eq(jobs.companyId, companyId))
      .returning({ id: jobs.id });

    return NextResponse.json({
      success: true,
      deletedCount: result.length,
      message: `Deleted ${result.length} job(s) for company ${companyId}`,
    });
  } catch (error) {
    console.error("Failed to delete company jobs:", error);
    return NextResponse.json(
      { error: "Failed to delete jobs" },
      { status: 500 }
    );
  }
}
