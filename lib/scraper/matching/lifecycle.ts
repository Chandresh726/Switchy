import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  jobs,
  matchLogs,
  matchSessions,
  scrapeMatchOutbox,
  scrapingLogs,
} from "@/lib/db/schema";

export interface StopMatchSessionResult {
  exists: boolean;
  stopped: boolean;
  status: string | null;
}

export function stopMatchSession(
  sessionId: string,
  database: typeof db = db
): StopMatchSessionResult {
  return database.transaction((tx) => {
    const session = tx
      .select({
        id: matchSessions.id,
        status: matchSessions.status,
      })
      .from(matchSessions)
      .where(eq(matchSessions.id, sessionId))
      .limit(1)
      .get();
    if (!session) return { exists: false, stopped: false, status: null };
    if (session.status !== "queued" && session.status !== "in_progress") {
      return { exists: true, stopped: false, status: session.status };
    }

    const stoppedAt = new Date();
    const checkpointLogs = tx
      .select({ jobId: matchLogs.jobId, status: matchLogs.status })
      .from(matchLogs)
      .where(eq(matchLogs.sessionId, sessionId))
      .orderBy(asc(matchLogs.id))
      .all();
    const checkpointByJob = new Map<number, string>();
    for (const log of checkpointLogs) {
      if (log.jobId !== null) checkpointByJob.set(log.jobId, log.status);
    }
    const checkpointStatuses = Array.from(checkpointByJob.values());
    const jobsSucceeded = checkpointStatuses.filter(
      (status) => status === "success"
    ).length;
    const jobsFailed = checkpointStatuses.length - jobsSucceeded;
    const stopped = tx
      .update(matchSessions)
      .set({
        status: "failed",
        jobsCompleted: checkpointStatuses.length,
        jobsSucceeded,
        jobsFailed,
        errorCount: jobsFailed,
        completedAt: stoppedAt,
      })
      .where(
        and(
          eq(matchSessions.id, sessionId),
          inArray(matchSessions.status, ["queued", "in_progress"])
        )
      )
      .returning({ id: matchSessions.id })
      .get();
    if (!stopped) {
      const current = tx
        .select({ status: matchSessions.status })
        .from(matchSessions)
        .where(eq(matchSessions.id, sessionId))
        .limit(1)
        .get();
      return {
        exists: Boolean(current),
        stopped: false,
        status: current?.status ?? null,
      };
    }

    const outbox = tx
      .update(scrapeMatchOutbox)
      .set({
        status: "failed",
        workerId: null,
        leaseExpiresAt: null,
        lastError: "Matching was stopped by the user.",
        completedAt: stoppedAt,
        updatedAt: stoppedAt,
      })
      .where(
        and(
          eq(scrapeMatchOutbox.id, sessionId),
          inArray(scrapeMatchOutbox.status, ["pending", "running"])
        )
      )
      .returning({ scrapingLogId: scrapeMatchOutbox.scrapingLogId })
      .get();
    if (outbox) {
      tx.update(scrapingLogs)
        .set({
          matcherStatus: "failed",
          matcherJobsCompleted: checkpointStatuses.length,
          matcherErrorCount: jobsFailed,
        })
        .where(eq(scrapingLogs.id, outbox.scrapingLogId))
        .run();
    }

    return { exists: true, stopped: true, status: "failed" };
  }, { behavior: "immediate" });
}

export function deleteAllJobsAndTerminateMatches(database: typeof db = db): void {
  database.transaction((tx) => {
    const outboxes = tx
      .select({
        sessionId: scrapeMatchOutbox.id,
        scrapingLogId: scrapeMatchOutbox.scrapingLogId,
      })
      .from(scrapeMatchOutbox)
      .where(inArray(scrapeMatchOutbox.status, ["pending", "running"]))
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

    tx.update(matchSessions)
      .set({ status: "failed", completedAt: new Date() })
      .where(inArray(matchSessions.status, ["queued", "in_progress"]))
      .run();
    tx.delete(jobs).run();
  }, { behavior: "immediate" });
}
