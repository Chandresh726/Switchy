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
    const { summary } = result;
    const messageParts = [
      `Refreshed ${summary.successfulCompanies} compan${summary.successfulCompanies === 1 ? "y" : "ies"}`,
    ];

    if (summary.skippedCompanies > 0) {
      messageParts.push(
        `skipped ${summary.skippedCompanies} custom compan${summary.skippedCompanies === 1 ? "y" : "ies"} without scraping support`
      );
    }

    if (summary.failedCompanies > 0) {
      messageParts.push(
        `${summary.failedCompanies} compan${summary.failedCompanies === 1 ? "y failed" : "ies failed"}`
      );
    }

    return NextResponse.json({
      success: summary.failedCompanies === 0,
      sessionId: result.sessionId,
      totalCompanies: summary.totalCompanies,
      refreshedCompanies: summary.successfulCompanies,
      skippedCompanies: summary.skippedCompanies,
      totalJobsFound: summary.totalJobsFound,
      totalJobsAdded: summary.totalJobsAdded,
      totalJobsFiltered: summary.totalJobsFiltered,
      failedCompanies: summary.failedCompanies,
      message: `${messageParts.join(", ")}. Found ${summary.totalJobsFound} jobs, added ${summary.totalJobsAdded} new.`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
