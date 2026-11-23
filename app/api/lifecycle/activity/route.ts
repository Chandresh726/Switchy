import { NextResponse } from "next/server";

import { count, eq, inArray } from "drizzle-orm";

import { handleApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { aiRuns, aiWorkItems, scrapeMatchOutbox, scrapeQueueItems, scrapeSessions } from "@/lib/db/schema";
import { getSchedulerStatus } from "@/lib/jobs/scheduler";
import { hasRecentMutation } from "@/lib/runtime/update-maintenance";
import { getLocalDataOperationGate } from "@/lib/scraper/runtime/data-operation-gate";
import { NO_STORE_HEADERS } from "@/lib/utils/api-headers";

async function isIdle(): Promise<boolean> {
  const groups = await Promise.all([
    db.select({ value: count() }).from(scrapeQueueItems).where(inArray(scrapeQueueItems.status, ["queued", "running"])),
    db.select({ value: count() }).from(aiWorkItems).where(inArray(aiWorkItems.status, ["queued", "running"])),
    db.select({ value: count() }).from(scrapeMatchOutbox).where(inArray(scrapeMatchOutbox.status, ["pending", "running"])),
    db.select({ value: count() }).from(scrapeSessions).where(eq(scrapeSessions.status, "in_progress")),
    db.select({ value: count() }).from(aiRuns).where(eq(aiRuns.status, "running")),
  ]);
  const scheduler = await getSchedulerStatus();
  return !scheduler.isRunning && !hasRecentMutation() && groups.every((rows) => rows[0].value === 0);
}

export async function GET(request: Request) {
  try {
    // Report busy promptly rather than waiting behind a long scrape or match.
    // Once apparently idle, drain the data gate and recheck for racing work.
    const idle = await isIdle() && await getLocalDataOperationGate().runMaintenance(isIdle);
    return NextResponse.json({ idle }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Could not check active work" });
  }
}
