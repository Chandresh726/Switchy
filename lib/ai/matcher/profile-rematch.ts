import { queueProfileRematchWork } from "@/lib/ai/work-items/service";
import { db } from "@/lib/db";
import { matchResults } from "@/lib/db/schema";

async function enqueueProfileRematch(): Promise<void> {
  const rows = await db.selectDistinct({ jobId: matchResults.jobId })
    .from(matchResults);
  const jobIds = rows.map((row) => row.jobId);
  if (jobIds.length === 0) return;

  queueProfileRematchWork(jobIds);
}

/**
 * Persist the rematch before the request completes. The work repository merges
 * this job set into an existing queued profile-update session when possible.
 * Only jobs that have previously been matched are queued; editing a profile
 * must not unexpectedly match the entire database.
 */
export async function scheduleProfileRematch(): Promise<void> {
  await enqueueProfileRematch();
}
