import { NextRequest, NextResponse } from "next/server";
import { fetchJobsForCompany, fetchJobsForAllCompanies } from "@/lib/jobs/fetcher";

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (companyId) {
      // Refresh jobs for a specific company
      const result = await fetchJobsForCompany(parseInt(companyId), {
        triggerSource: "manual",
      });
      return NextResponse.json(result);
    } else {
      // Refresh jobs for all companies
      const batchResult = await fetchJobsForAllCompanies("manual");
      return NextResponse.json({
        success: true,
        sessionId: batchResult.sessionId,
        results: batchResult.results,
        summary: batchResult.summary,
      });
    }
  } catch (error) {
    console.error("Failed to refresh jobs:", error);
    return NextResponse.json(
      { error: "Failed to refresh jobs" },
      { status: 500 }
    );
  }
}
