import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jobs, companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { matchWithTracking } from "@/lib/ai/matcher";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const companyId = parseInt(id, 10);

    if (isNaN(companyId)) {
      return NextResponse.json(
        { error: "Invalid company ID" },
        { status: 400 }
      );
    }

    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId));

    if (!company) {
      return NextResponse.json(
        { error: "Company not found" },
        { status: 404 }
      );
    }

    const companyJobs = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.companyId, companyId));

    if (companyJobs.length === 0) {
      return NextResponse.json({
        success: true,
        sessionId: "",
        total: 0,
        succeeded: 0,
        failed: 0,
        message: "No jobs to match for this company",
      });
    }

    const jobIds = companyJobs.map((j) => j.id);

    console.log(`[Company Match] Starting match for ${jobIds.length} jobs from company ${company.name}`);

    const result = await matchWithTracking(jobIds, {
      triggerSource: "company_refresh",
      companyId,
    });

    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
      message: `Matched ${result.succeeded} of ${result.total} jobs`,
    });
  } catch (error) {
    console.error("[Company Match API] POST error:", error);
    return NextResponse.json(
      { error: "Failed to match company jobs" },
      { status: 500 }
    );
  }
}
