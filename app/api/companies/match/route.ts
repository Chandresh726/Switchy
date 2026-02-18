import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { matchWithTracking } from "@/lib/ai/matcher";
import { handleApiError, ValidationError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyIds } = body as { companyIds: number[] };

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      throw new ValidationError("companyIds must be a non-empty array");
    }

    const companyJobs = await db
      .select({ id: jobs.id, companyId: jobs.companyId })
      .from(jobs)
      .where(inArray(jobs.companyId, companyIds));

    if (companyJobs.length === 0) {
      return NextResponse.json({
        success: true,
        total: 0,
        succeeded: 0,
        failed: 0,
        message: "No jobs found for selected companies",
      });
    }

    const jobIds = companyJobs.map((j) => j.id);

    console.log(`[Match API] Starting match for ${jobIds.length} jobs from ${companyIds.length} companies`);

    const result = await matchWithTracking(jobIds, {
      triggerSource: "manual",
    });

    return NextResponse.json({
      success: true,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
      message: `Matched ${result.succeeded} of ${result.total} jobs`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
