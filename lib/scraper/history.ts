import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";
import {
  matchSessions,
  scrapeMatchOutbox,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";

export interface DeleteScrapeHistoryResult {
  active: boolean;
  deleted: number;
}

export interface PruneScrapeHistoryResult {
  deleted: number;
  cutoff: Date;
}

export interface ScrapeHistoryRetentionStore {
  prune(retentionDays: number, now: Date): PruneScrapeHistoryResult;
}

export class DrizzleScrapeHistoryRetentionStore
  implements ScrapeHistoryRetentionStore
{
  constructor(private readonly database: typeof db = db) {}

  prune(retentionDays: number, now: Date): PruneScrapeHistoryResult {
    return pruneScrapeHistory(retentionDays, this.database, now);
  }
}

const HISTORY_DELETE_BATCH_SIZE = 200;

export function deleteScrapeHistory(
  sessionId?: string,
  database: typeof db = db
): DeleteScrapeHistoryResult {
  return database.transaction((tx) => {
    const sessionsToDelete = sessionId
      ? tx
          .select({ id: scrapeSessions.id, status: scrapeSessions.status })
          .from(scrapeSessions)
          .where(eq(scrapeSessions.id, sessionId))
          .all()
      : tx
          .select({ id: scrapeSessions.id, status: scrapeSessions.status })
          .from(scrapeSessions)
          .where(ne(scrapeSessions.status, "in_progress"))
          .all();
    if (sessionId && sessionsToDelete[0]?.status === "in_progress") {
      return { active: true, deleted: 0 };
    }
    const candidateSessionIds = sessionsToDelete.map((session) => session.id);
    if (candidateSessionIds.length === 0) {
      return { active: false, deleted: 0 };
    }
    let deletedCount = 0;
    for (const candidateBatch of chunkSqliteParameters(
      candidateSessionIds,
      HISTORY_DELETE_BATCH_SIZE
    )) {
      const leasedSessionIds = new Set(
        tx
          .selectDistinct({ sessionId: scrapeQueueItems.sessionId })
          .from(scrapeQueueItems)
          .where(
            and(
              inArray(scrapeQueueItems.sessionId, candidateBatch),
              inArray(scrapeQueueItems.status, ["queued", "running"])
            )
          )
          .all()
          .map((item) => item.sessionId)
      );
      if (sessionId && leasedSessionIds.has(sessionId)) {
        return { active: true, deleted: 0 };
      }
      const sessionIds = candidateBatch.filter(
        (candidateId) => !leasedSessionIds.has(candidateId)
      );
      if (sessionIds.length === 0) continue;

      const matchSessionIds = tx
        .select({ id: scrapeMatchOutbox.id })
        .from(scrapeMatchOutbox)
        .innerJoin(scrapingLogs, eq(scrapeMatchOutbox.scrapingLogId, scrapingLogs.id))
        .where(inArray(scrapingLogs.sessionId, sessionIds))
        .all()
        .map((row) => row.id);
      for (const matchBatch of chunkSqliteParameters(
        matchSessionIds,
        HISTORY_DELETE_BATCH_SIZE
      )) {
        tx.delete(matchSessions)
          .where(inArray(matchSessions.id, matchBatch))
          .run();
      }

      deletedCount += tx
        .delete(scrapeSessions)
        .where(inArray(scrapeSessions.id, sessionIds))
        .returning({ id: scrapeSessions.id })
        .all().length;
    }
    return { active: false, deleted: deletedCount };
  }, { behavior: "immediate" });
}

export function pruneScrapeHistory(
  retentionDays: number,
  database: typeof db = db,
  now: Date = new Date()
): PruneScrapeHistoryResult {
  const normalizedDays = Math.min(3_650, Math.max(7, Math.floor(retentionDays)));
  const cutoff = new Date(now.getTime() - normalizedDays * 24 * 60 * 60 * 1000);
  const deleted = database.transaction((tx) => {
    const candidateSessionIds = tx
      .select({ id: scrapeSessions.id })
      .from(scrapeSessions)
      .where(
        and(
          ne(scrapeSessions.status, "in_progress"),
          or(
            lt(scrapeSessions.completedAt, cutoff),
            and(
              isNull(scrapeSessions.completedAt),
              lt(scrapeSessions.startedAt, cutoff)
            )
          )
        )
      )
      .all()
      .map((session) => session.id);
    if (candidateSessionIds.length === 0) return 0;

    let deletedCount = 0;
    for (const candidateBatch of chunkSqliteParameters(
      candidateSessionIds,
      HISTORY_DELETE_BATCH_SIZE
    )) {
      const leasedSessionIds = new Set(
        tx
          .selectDistinct({ sessionId: scrapeQueueItems.sessionId })
          .from(scrapeQueueItems)
          .where(
            and(
              inArray(scrapeQueueItems.sessionId, candidateBatch),
              inArray(scrapeQueueItems.status, ["queued", "running"])
            )
          )
          .all()
          .map((item) => item.sessionId)
      );
      const matchingSessionIds = new Set(
        tx
          .selectDistinct({ sessionId: scrapingLogs.sessionId })
          .from(scrapeMatchOutbox)
          .innerJoin(scrapingLogs, eq(scrapingLogs.id, scrapeMatchOutbox.scrapingLogId))
          .where(
            and(
              inArray(scrapingLogs.sessionId, candidateBatch),
              inArray(scrapeMatchOutbox.status, ["pending", "running"])
            )
          )
          .all()
          .flatMap((item) => (item.sessionId ? [item.sessionId] : []))
      );
      const sessionIds = candidateBatch.filter(
        (sessionId) =>
          !leasedSessionIds.has(sessionId) && !matchingSessionIds.has(sessionId)
      );
      if (sessionIds.length === 0) continue;

      const matchSessionIds = tx
        .select({ id: scrapeMatchOutbox.id })
        .from(scrapeMatchOutbox)
        .innerJoin(scrapingLogs, eq(scrapeMatchOutbox.scrapingLogId, scrapingLogs.id))
        .where(inArray(scrapingLogs.sessionId, sessionIds))
        .all()
        .map((row) => row.id);
      for (const matchBatch of chunkSqliteParameters(
        matchSessionIds,
        HISTORY_DELETE_BATCH_SIZE
      )) {
        tx.delete(matchSessions)
          .where(inArray(matchSessions.id, matchBatch))
          .run();
      }

      deletedCount += tx
        .delete(scrapeSessions)
        .where(inArray(scrapeSessions.id, sessionIds))
        .returning({ id: scrapeSessions.id })
        .all().length;
    }
    return deletedCount;
  }, { behavior: "immediate" });

  return { deleted, cutoff };
}
