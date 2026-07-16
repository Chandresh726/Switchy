import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { assertAppRequest, handleApiError } from "@/lib/api";
import { getLocalDataMaintenanceService } from "@/lib/scraper/maintenance";

/**
 * DELETE /api/jobs/match-data
 * Deletes all match sessions, match logs, and clears match data from jobs
 */
export async function DELETE(request: NextRequest) {
  try {
    assertAppRequest(request);

    const jobsCleared = await getLocalDataMaintenanceService().deleteMatchData();

    console.log(`[Match Data] Cleared match data from ${jobsCleared} jobs`);

    return NextResponse.json({
      success: true,
      jobsCleared,
      message: `Cleared match data from ${jobsCleared} jobs`,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to delete match data", fallbackCode: "match_data_delete_failed" });
  }
}
