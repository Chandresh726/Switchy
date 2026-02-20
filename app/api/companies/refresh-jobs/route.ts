import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleApiError, ValidationError } from "@/lib/api";
import { getScrapingModule } from "@/lib/scraper";

const RefreshJobsSchema = z.object({
  companyIds: z.array(z.coerce.number().int().positive()).min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = RefreshJobsSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("companyIds must be a non-empty array of positive numbers");
    }

    const { orchestrator } = getScrapingModule();

    const result = await orchestrator.scrapeCompanies(parsed.data.companyIds, "manual");

    return NextResponse.json({
      success: result.summary.failedCompanies === 0,
      sessionId: result.sessionId,
      totalCompanies: result.summary.totalCompanies,
      totalJobsFound: result.summary.totalJobsFound,
      totalJobsAdded: result.summary.totalJobsAdded,
      totalJobsFiltered: result.summary.totalJobsFiltered,
      failedCompanies: result.summary.failedCompanies,
      message: `Refreshed jobs for ${result.summary.totalCompanies} companies. Found ${result.summary.totalJobsFound} jobs, added ${result.summary.totalJobsAdded} new.`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
