import { NextRequest, NextResponse } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { companyIdsBodySchema } from "@/lib/api/contracts/companies";
import { getLocalScrapeQueueService } from "@/lib/scraper";

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const parsed = companyIdsBodySchema.parse(await request.json());

    const result = await getLocalScrapeQueueService().scrapeCompanies(
      parsed.companyIds,
      "manual"
    );
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
    return handleApiError(error, { request, fallbackMessage: "Failed to refresh company jobs", fallbackCode: "company_jobs_refresh_failed" });
  }
}
