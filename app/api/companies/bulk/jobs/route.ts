import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
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

    const deleted = await db
      .delete(jobs)
      .where(inArray(jobs.companyId, companyIds))
      .returning({ id: jobs.id });

    return NextResponse.json({
      success: true,
      deletedCount: deleted.length,
      message: `Deleted ${deleted.length} jobs from ${companyIds.length} companies`,
    });
  } catch (error) {
    console.error("Failed to delete jobs:", error);
    return NextResponse.json(
      { error: "Failed to delete jobs" },
      { status: 500 }
    );
  }
}
