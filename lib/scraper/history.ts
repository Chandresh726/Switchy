import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";
import {
  companies,
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

type ScrapeSession = typeof scrapeSessions.$inferSelect;

export interface ScrapeHistoryDetail {
  session: ScrapeSession;
  logs: Array<{
    id: number;
    companyId: number | null;
    companyName: string | null;
    companyLogoUrl: string | null;
    platform: string | null;
    status: string;
    jobsFound: number | null;
    jobsAdded: number | null;
    jobsUpdated: number | null;
    jobsFiltered: number | null;
    jobsArchived: number | null;
    errorMessage: string | null;
    duration: number | null;
    startedAt: Date | null;
    completedAt: Date | null;
    matcherStatus: string | null;
    matcherJobsTotal: number | null;
    matcherJobsCompleted: number | null;
    matcherDuration: number | null;
    matcherErrorCount: number | null;
  }>;
  queueItems: Array<{
    id: string;
    companyId: number;
    companyName: string | null;
    status: string;
    attemptCount: number;
    maxAttempts: number;
    availableAt: Date;
    workerId: string | null;
    lockedAt: Date | null;
    leaseExpiresAt: Date | null;
    cancelRequested: boolean;
    lastError: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface ScrapeHistoryPage {
  sessions: ScrapeSession[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  stats: {
    totalSessions: number;
    successRate: number;
    avgDuration: number;
  };
}

export interface ScrapeHistoryStore extends ScrapeHistoryRetentionStore {
  getDetail(sessionId: string): ScrapeHistoryDetail | null;
  list(options: { limit: number; offset: number }): ScrapeHistoryPage;
  getSessionStatus(sessionId: string): { id: string; status: string } | null;
  delete(sessionId?: string): DeleteScrapeHistoryResult;
}

export class DrizzleScrapeHistoryStore implements ScrapeHistoryStore {
  constructor(private readonly database: typeof db = db) {}

  getDetail(sessionId: string): ScrapeHistoryDetail | null {
    const session = this.database
      .select()
      .from(scrapeSessions)
      .where(eq(scrapeSessions.id, sessionId))
      .get();
    if (!session) return null;

    const logs = this.database
      .select({
        id: scrapingLogs.id,
        companyId: scrapingLogs.companyId,
        companyName: companies.name,
        companyLogoUrl: companies.logoUrl,
        platform: scrapingLogs.platform,
        status: scrapingLogs.status,
        jobsFound: scrapingLogs.jobsFound,
        jobsAdded: scrapingLogs.jobsAdded,
        jobsUpdated: scrapingLogs.jobsUpdated,
        jobsFiltered: scrapingLogs.jobsFiltered,
        jobsArchived: scrapingLogs.jobsArchived,
        errorMessage: scrapingLogs.errorMessage,
        duration: scrapingLogs.duration,
        startedAt: scrapingLogs.startedAt,
        completedAt: scrapingLogs.completedAt,
        matcherStatus: scrapingLogs.matcherStatus,
        matcherJobsTotal: scrapingLogs.matcherJobsTotal,
        matcherJobsCompleted: scrapingLogs.matcherJobsCompleted,
        matcherDuration: scrapingLogs.matcherDuration,
        matcherErrorCount: scrapingLogs.matcherErrorCount,
      })
      .from(scrapingLogs)
      .leftJoin(companies, eq(scrapingLogs.companyId, companies.id))
      .where(eq(scrapingLogs.sessionId, sessionId))
      .orderBy(scrapingLogs.startedAt)
      .all();
    const queueItems = this.database
      .select({
        id: scrapeQueueItems.id,
        companyId: scrapeQueueItems.companyId,
        companyName: companies.name,
        status: scrapeQueueItems.status,
        attemptCount: scrapeQueueItems.attemptCount,
        maxAttempts: scrapeQueueItems.maxAttempts,
        availableAt: scrapeQueueItems.availableAt,
        workerId: scrapeQueueItems.workerId,
        lockedAt: scrapeQueueItems.lockedAt,
        leaseExpiresAt: scrapeQueueItems.leaseExpiresAt,
        cancelRequested: scrapeQueueItems.cancelRequested,
        lastError: scrapeQueueItems.lastError,
        startedAt: scrapeQueueItems.startedAt,
        completedAt: scrapeQueueItems.completedAt,
        createdAt: scrapeQueueItems.createdAt,
        updatedAt: scrapeQueueItems.updatedAt,
      })
      .from(scrapeQueueItems)
      .leftJoin(companies, eq(companies.id, scrapeQueueItems.companyId))
      .where(eq(scrapeQueueItems.sessionId, sessionId))
      .orderBy(scrapeQueueItems.createdAt)
      .all();

    return { session, logs, queueItems };
  }

  list({ limit, offset }: { limit: number; offset: number }): ScrapeHistoryPage {
    const sessions = this.database
      .select()
      .from(scrapeSessions)
      .orderBy(
        desc(
          sql`coalesce(${scrapeSessions.scheduledForAt}, ${scrapeSessions.startedAt})`
        )
      )
      .limit(limit)
      .offset(offset)
      .all();
    const total = Number(
      this.database
        .select({ count: sql<number>`count(*)` })
        .from(scrapeSessions)
        .get()?.count ?? 0
    );
    const stats = this.database
      .select({
        totalSessions: sql<number>`count(*)`,
        successRate: sql<number>`ROUND(CAST(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) * 100, 1)`,
        avgDuration: sql<number>`ROUND(AVG((completed_at - started_at) * 1000), 0)`,
      })
      .from(scrapeSessions)
      .get();

    return {
      sessions,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
      stats: {
        totalSessions: Number(stats?.totalSessions ?? 0),
        successRate: Number(stats?.successRate ?? 0),
        avgDuration: Number(stats?.avgDuration ?? 0),
      },
    };
  }

  getSessionStatus(sessionId: string): { id: string; status: string } | null {
    return (
      this.database
        .select({ id: scrapeSessions.id, status: scrapeSessions.status })
        .from(scrapeSessions)
        .where(eq(scrapeSessions.id, sessionId))
        .get() ?? null
    );
  }

  delete(sessionId?: string): DeleteScrapeHistoryResult {
    return deleteScrapeHistory(sessionId, this.database);
  }

  prune(retentionDays: number, now: Date): PruneScrapeHistoryResult {
    return pruneScrapeHistory(retentionDays, this.database, now);
  }
}

let defaultHistoryStore: ScrapeHistoryStore | null = null;

export function getScrapeHistoryStore(): ScrapeHistoryStore {
  if (!defaultHistoryStore) {
    defaultHistoryStore = new DrizzleScrapeHistoryStore();
  }
  return defaultHistoryStore;
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
