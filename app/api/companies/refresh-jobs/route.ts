import { NextRequest, NextResponse } from "next/server";
import { getScrapingModule } from "@/lib/scraper";
import { handleApiError, ValidationError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyIds } = body as { companyIds: number[] };

    if (!Array.isArray(companyIds) || companyIds.length === 0) {
      throw new ValidationError("companyIds must be a non-empty array");
    }

    const { orchestrator, repository } = getScrapingModule();

    const sessionId = crypto.randomUUID();
    const companies = await repository.getActiveCompanies();
    const selectedCompanies = companies.filter((c) => companyIds.includes(c.id));

    if (selectedCompanies.length === 0) {
      return NextResponse.json({
        success: true,
        sessionId: null,
        totalCompanies: 0,
        totalJobsFound: 0,
        totalJobsAdded: 0,
        message: "No active companies found in selection",
      });
    }

    await repository.createSession({
      id: sessionId,
      triggerSource: "manual",
      status: "in_progress",
      companiesTotal: selectedCompanies.length,
    });

    let totalJobsFound = 0;
    let totalJobsAdded = 0;
    let totalJobsFiltered = 0;
    let completed = 0;

    for (const company of selectedCompanies) {
      const result = await orchestrator.scrapeCompany(company.id, {
        sessionId,
        triggerSource: "manual",
      });

      totalJobsFound += result.jobsFound;
      totalJobsAdded += result.jobsAdded;
      totalJobsFiltered += result.jobsFiltered;
      completed++;

      await repository.updateSessionProgress(sessionId, {
        companiesCompleted: completed,
        totalJobsFound,
        totalJobsAdded,
        totalJobsFiltered,
      });
    }

    await repository.completeSession(sessionId, false);

    return NextResponse.json({
      success: true,
      sessionId,
      totalCompanies: selectedCompanies.length,
      totalJobsFound,
      totalJobsAdded,
      message: `Refreshed jobs for ${selectedCompanies.length} companies. Found ${totalJobsFound} jobs, added ${totalJobsAdded} new.`,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
