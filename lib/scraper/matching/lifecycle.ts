import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  jobs,
  matchSessions,
  scrapeMatchOutbox,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";
import {
  DrizzleMatchWorkStore,
  type StopMatchSessionResult,
} from "@/lib/scraper/matching/match-work-store";

export async function stopMatchSession(
  sessionId: string,
  database: typeof db = db
): Promise<StopMatchSessionResult> {
  return new DrizzleMatchWorkStore(database).stopSession(sessionId);
}

function deleteJobsAndTerminateWork(
  companyIds: number[] | null,
  database: typeof db
): number {
  return database.transaction((tx) => {
    const activeQueueCondition = companyIds
      ? and(
          eq(scrapeSessions.status, "in_progress"),
          inArray(scrapeQueueItems.companyId, companyIds)
        )
      : eq(scrapeSessions.status, "in_progress");
    const activeScrapeSessionIds = tx
      .selectDistinct({ sessionId: scrapeQueueItems.sessionId })
      .from(scrapeQueueItems)
      .innerJoin(scrapeSessions, eq(scrapeSessions.id, scrapeQueueItems.sessionId))
      .where(activeQueueCondition)
      .all()
      .map((item) => item.sessionId);
    if (activeScrapeSessionIds.length > 0) {
      const stoppedAt = new Date();
      tx.update(scrapeQueueItems)
        .set({
          status: "cancelled",
          cancelRequested: true,
          completedAt: stoppedAt,
          updatedAt: stoppedAt,
        })
        .where(
          and(
            inArray(scrapeQueueItems.sessionId, activeScrapeSessionIds),
            eq(scrapeQueueItems.status, "queued")
          )
        )
        .run();
      tx.update(scrapeQueueItems)
        .set({ cancelRequested: true, updatedAt: stoppedAt })
        .where(
          and(
            inArray(scrapeQueueItems.sessionId, activeScrapeSessionIds),
            eq(scrapeQueueItems.status, "running")
          )
        )
        .run();
      tx.update(scrapeSessions)
        .set({ status: "failed", completedAt: stoppedAt })
        .where(inArray(scrapeSessions.id, activeScrapeSessionIds))
        .run();
    }

    const activeOutboxCondition = companyIds
      ? and(
          inArray(scrapeMatchOutbox.status, ["pending", "running"]),
          inArray(scrapeMatchOutbox.companyId, companyIds)
        )
      : inArray(scrapeMatchOutbox.status, ["pending", "running"]);
    const outboxes = tx
      .select({
        sessionId: scrapeMatchOutbox.id,
        scrapingLogId: scrapeMatchOutbox.scrapingLogId,
      })
      .from(scrapeMatchOutbox)
      .where(activeOutboxCondition)
      .all();
    const outboxSessionIds = outboxes.map((outbox) => outbox.sessionId);
    const scrapingLogIds = outboxes.map((outbox) => outbox.scrapingLogId);

    if (scrapingLogIds.length > 0) {
      tx.update(scrapingLogs)
        .set({
          matcherStatus: null,
          matcherJobsTotal: null,
          matcherJobsCompleted: 0,
          matcherDuration: null,
          matcherErrorCount: 0,
        })
        .where(inArray(scrapingLogs.id, scrapingLogIds))
        .run();
    }
    if (outboxSessionIds.length > 0) {
      tx.delete(matchSessions)
        .where(inArray(matchSessions.id, outboxSessionIds))
        .run();
    }

    const activeMatchCondition = companyIds
      ? and(
          inArray(matchSessions.status, ["queued", "in_progress"]),
          inArray(matchSessions.companyId, companyIds)
        )
      : inArray(matchSessions.status, ["queued", "in_progress"]);
    tx.update(matchSessions)
      .set({ status: "failed", completedAt: new Date() })
      .where(activeMatchCondition)
      .run();

    const deletion = tx.delete(jobs);
    return companyIds
      ? deletion
          .where(inArray(jobs.companyId, companyIds))
          .returning({ id: jobs.id })
          .all().length
      : deletion.returning({ id: jobs.id }).all().length;
  }, { behavior: "immediate" });
}

export function deleteAllJobsAndTerminateMatches(database: typeof db = db): void {
  deleteJobsAndTerminateWork(null, database);
}

export function deleteCompanyJobsAndTerminateWork(
  companyIds: number[],
  database: typeof db = db
): number {
  if (companyIds.length === 0) return 0;
  return deleteJobsAndTerminateWork(Array.from(new Set(companyIds)), database);
}
