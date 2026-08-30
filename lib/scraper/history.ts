import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";
import {
  aiWorkItems,
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

const HISTORY_LOOKUP_BATCH_SIZE = 200;

interface ScrapeProgressKey {
  key: string;
  companyId: number | null;
  companyName: string | null;
  queueItemId: string | null;
  standaloneLogId: number | null;
}

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
    fetchDuration: number | null;
    processingDuration: number | null;
    persistenceDuration: number | null;
    startedAt: Date | null;
    completedAt: Date | null;
    matcherStatus: string | null;
    matcherJobsTotal: number | null;
    matcherJobsCompleted: number | null;
    matcherDuration: number | null;
    matcherErrorCount: number | null;
    matchSessionId: string | null;
    attemptNumber: number;
    attemptsTotal: number;
    isFinalAttempt: boolean;
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  hasActiveWork: boolean;
  queueItems: Array<{
    id: string;
    companyId: number;
    companyName: string | null;
    companyLogoUrl: string | null;
    platform: string | null;
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
    completedSessions: number;
    failedSessions: number;
    successRate: number;
    avgDuration: number;
    companiesScraped: number;
    totalJobsFound: number;
    totalJobsAdded: number;
    lastRunAt: Date | null;
  };
}

export interface ScrapeHistoryStore extends ScrapeHistoryRetentionStore {
  getDetail(
    sessionId: string,
    page: { limit: number; offset: number }
  ): ScrapeHistoryDetail | null;
  list(options: { limit: number; offset: number }): ScrapeHistoryPage;
  getSessionStatus(sessionId: string): { id: string; status: string } | null;
  delete(sessionId?: string): DeleteScrapeHistoryResult;
}

export class DrizzleScrapeHistoryStore implements ScrapeHistoryStore {
  constructor(private readonly database: typeof db = db) {}

  getDetail(
    sessionId: string,
    page: { limit: number; offset: number } = { limit: 50, offset: 0 }
  ): ScrapeHistoryDetail | null {
    const session = this.database
      .select()
      .from(scrapeSessions)
      .where(eq(scrapeSessions.id, sessionId))
      .get();
    if (!session) return null;

    const progressKeys = this.getProgressKeys(sessionId);
    const pageKeys = progressKeys.slice(page.offset, page.offset + page.limit);
    const selectedQueueItemIds = pageKeys.flatMap((item) =>
      item.queueItemId === null ? [] : [item.queueItemId]
    );
    const selectedCompanyIds = Array.from(new Set(pageKeys.flatMap((item) =>
      item.companyId === null ? [] : [item.companyId]
    )));
    const selectedStandaloneLogIds = pageKeys.flatMap((item) =>
      item.standaloneLogId === null ? [] : [item.standaloneLogId]
    );

    const rawLogs = this.database
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
        fetchDuration: scrapingLogs.fetchDuration,
        processingDuration: scrapingLogs.processingDuration,
        persistenceDuration: scrapingLogs.persistenceDuration,
        startedAt: scrapingLogs.startedAt,
        completedAt: scrapingLogs.completedAt,
        matcherStatus: scrapingLogs.matcherStatus,
        matcherJobsTotal: scrapingLogs.matcherJobsTotal,
        matcherJobsCompleted: scrapingLogs.matcherJobsCompleted,
        matcherDuration: scrapingLogs.matcherDuration,
        matcherErrorCount: scrapingLogs.matcherErrorCount,
        attemptNumber: sql<number>`row_number() over (partition by ${scrapingLogs.companyId} order by ${scrapingLogs.startedAt}, ${scrapingLogs.id})`,
        attemptsTotal: sql<number>`count(*) over (partition by ${scrapingLogs.companyId})`,
      })
      .from(scrapingLogs)
      .leftJoin(companies, eq(scrapingLogs.companyId, companies.id))
      .where(and(
        eq(scrapingLogs.sessionId, sessionId),
        or(
          inArray(scrapingLogs.companyId, selectedCompanyIds),
          inArray(scrapingLogs.id, selectedStandaloneLogIds)
        )
      ))
      .orderBy(scrapingLogs.startedAt, scrapingLogs.id)
      .all();
    const queueItems = this.database
      .select({
        id: scrapeQueueItems.id,
        companyId: scrapeQueueItems.companyId,
        companyName: companies.name,
        companyLogoUrl: companies.logoUrl,
        platform: companies.platform,
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
      .where(and(
        eq(scrapeQueueItems.sessionId, sessionId),
        inArray(scrapeQueueItems.id, selectedQueueItemIds)
      ))
      .all();
    const activeQueueItems = Number(this.database.select({ value: sql<number>`count(*)` })
      .from(scrapeQueueItems).where(and(
        eq(scrapeQueueItems.sessionId, sessionId),
        inArray(scrapeQueueItems.status, ["queued", "running"])
      )).get()?.value ?? 0);

    const queueStatusByCompany = new Map(
      queueItems.map((item) => [item.companyId, item.status])
    );
    const matchSessionByLogId = this.getMatchSessionIdsByLog(
      rawLogs.map((log) => log.id)
    );
    const logs = rawLogs.map((log) => {
      const matchSessionId = matchSessionByLogId.get(log.id) ?? null;
      if (log.companyId === null) {
        return {
          ...log,
          matchSessionId,
          attemptNumber: 1,
          attemptsTotal: 1,
          isFinalAttempt: true,
        };
      }
      const queueStatus = queueStatusByCompany.get(log.companyId);
      const queueIsTerminal =
        queueStatus === undefined ||
        ["completed", "failed", "cancelled"].includes(queueStatus);
      return {
        ...log,
        matchSessionId,
        isFinalAttempt:
          queueIsTerminal &&
          log.attemptNumber === log.attemptsTotal,
      };
    });

    return {
      session,
      logs,
      pagination: {
        total: progressKeys.length,
        limit: page.limit,
        offset: page.offset,
        hasMore: page.offset + pageKeys.length < progressKeys.length,
      },
      hasActiveWork: activeQueueItems > 0,
      queueItems,
    };
  }

  private getProgressKeys(sessionId: string): ScrapeProgressKey[] {
    const queueKeys = this.database
      .select({
        queueItemId: scrapeQueueItems.id,
        companyId: scrapeQueueItems.companyId,
        companyName: companies.name,
      })
      .from(scrapeQueueItems)
      .leftJoin(companies, eq(companies.id, scrapeQueueItems.companyId))
      .where(eq(scrapeQueueItems.sessionId, sessionId))
      .all();
    const logKeys = this.database
      .select({
        logId: scrapingLogs.id,
        companyId: scrapingLogs.companyId,
        companyName: companies.name,
      })
      .from(scrapingLogs)
      .leftJoin(companies, eq(companies.id, scrapingLogs.companyId))
      .where(eq(scrapingLogs.sessionId, sessionId))
      .orderBy(scrapingLogs.startedAt, scrapingLogs.id)
      .all();
    const progress = new Map<string, ScrapeProgressKey>();

    for (const item of queueKeys) {
      const key = `company-${item.companyId}`;
      progress.set(key, {
        key,
        companyId: item.companyId,
        companyName: item.companyName,
        queueItemId: item.queueItemId,
        standaloneLogId: null,
      });
    }

    for (const log of logKeys) {
      const key = log.companyId === null ? `log-${log.logId}` : `company-${log.companyId}`;
      if (progress.has(key)) continue;
      progress.set(key, {
        key,
        companyId: log.companyId,
        companyName: log.companyName,
        queueItemId: null,
        standaloneLogId: log.companyId === null ? log.logId : null,
      });
    }

    return Array.from(progress.values()).sort((left, right) => {
      const companyDifference = (left.companyName ?? "Unknown company").localeCompare(
        right.companyName ?? "Unknown company"
      );
      return companyDifference === 0 ? left.key.localeCompare(right.key) : companyDifference;
    });
  }

  /**
   * Resolves the match session that each scraping log handed its jobs to, so the
   * UI can deep-link into that match session. Reads the current durable work
   * table first and falls back to the legacy outbox for pre-migration rows.
   */
  private getMatchSessionIdsByLog(logIds: number[]): Map<number, string> {
    const byLogId = new Map<number, string>();
    if (logIds.length === 0) return byLogId;

    for (const batch of chunkSqliteParameters(logIds, HISTORY_LOOKUP_BATCH_SIZE)) {
      for (const row of this.database
        .select({
          logId: scrapeMatchOutbox.scrapingLogId,
          matchSessionId: scrapeMatchOutbox.id,
        })
        .from(scrapeMatchOutbox)
        .where(inArray(scrapeMatchOutbox.scrapingLogId, batch))
        .all()) {
        byLogId.set(row.logId, row.matchSessionId);
      }

      for (const row of this.database
        .select({
          logId: aiWorkItems.scrapingLogId,
          matchSessionId: aiWorkItems.matchSessionId,
        })
        .from(aiWorkItems)
        .where(
          and(
            inArray(aiWorkItems.scrapingLogId, batch),
            eq(aiWorkItems.workType, "match_jobs")
          )
        )
        .all()) {
        if (row.logId === null || row.matchSessionId === null) continue;
        byLogId.set(row.logId, row.matchSessionId);
      }
    }

    return byLogId;
  }

  list({ limit, offset }: { limit: number; offset: number }): ScrapeHistoryPage {
    const sessions = this.database
      .select()
      .from(scrapeSessions)
      .orderBy(desc(scrapeSessions.startedAt), desc(scrapeSessions.id))
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
        completedSessions: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        failedSessions: sql<number>`SUM(CASE WHEN status IN ('failed', 'cancelled') THEN 1 ELSE 0 END)`,
        successRate: sql<number>`ROUND(CAST(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS FLOAT) / NULLIF(COUNT(*), 0) * 100, 1)`,
        avgDuration: sql<number>`ROUND(AVG((completed_at - started_at) * 1000), 0)`,
        companiesScraped: sql<number>`SUM(COALESCE(companies_completed, 0))`,
        totalJobsFound: sql<number>`SUM(COALESCE(total_jobs_found, 0))`,
        totalJobsAdded: sql<number>`SUM(COALESCE(total_jobs_added, 0))`,
        lastRunAt: sql<number | null>`MAX(started_at)`,
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
        completedSessions: Number(stats?.completedSessions ?? 0),
        failedSessions: Number(stats?.failedSessions ?? 0),
        successRate: Number(stats?.successRate ?? 0),
        avgDuration: Number(stats?.avgDuration ?? 0),
        companiesScraped: Number(stats?.companiesScraped ?? 0),
        totalJobsFound: Number(stats?.totalJobsFound ?? 0),
        totalJobsAdded: Number(stats?.totalJobsAdded ?? 0),
        lastRunAt:
          stats?.lastRunAt === null || stats?.lastRunAt === undefined
            ? null
            : new Date(Number(stats.lastRunAt) * 1000),
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

      const matchSessionIds = Array.from(new Set([...tx
        .select({ id: scrapeMatchOutbox.id })
        .from(scrapeMatchOutbox)
        .innerJoin(scrapingLogs, eq(scrapeMatchOutbox.scrapingLogId, scrapingLogs.id))
        .where(inArray(scrapingLogs.sessionId, sessionIds))
        .all()
        .map((row) => row.id), ...tx
        .select({ id: aiWorkItems.matchSessionId })
        .from(aiWorkItems)
        .innerJoin(scrapingLogs, eq(aiWorkItems.scrapingLogId, scrapingLogs.id))
        .where(inArray(scrapingLogs.sessionId, sessionIds))
        .all()
        .flatMap((row) => row.id ? [row.id] : [])]));
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
        [...tx
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
          .flatMap((item) => (item.sessionId ? [item.sessionId] : [])), ...tx
          .selectDistinct({ sessionId: scrapingLogs.sessionId })
          .from(aiWorkItems)
          .innerJoin(scrapingLogs, eq(scrapingLogs.id, aiWorkItems.scrapingLogId))
          .where(and(
            inArray(scrapingLogs.sessionId, candidateBatch),
            inArray(aiWorkItems.status, ["queued", "running"])
          ))
          .all()
          .flatMap((item) => (item.sessionId ? [item.sessionId] : []))]
      );
      const sessionIds = candidateBatch.filter(
        (sessionId) =>
          !leasedSessionIds.has(sessionId) && !matchingSessionIds.has(sessionId)
      );
      if (sessionIds.length === 0) continue;

      const matchSessionIds = Array.from(new Set([...tx
        .select({ id: scrapeMatchOutbox.id })
        .from(scrapeMatchOutbox)
        .innerJoin(scrapingLogs, eq(scrapeMatchOutbox.scrapingLogId, scrapingLogs.id))
        .where(inArray(scrapingLogs.sessionId, sessionIds))
        .all()
        .map((row) => row.id), ...tx
        .select({ id: aiWorkItems.matchSessionId })
        .from(aiWorkItems)
        .innerJoin(scrapingLogs, eq(aiWorkItems.scrapingLogId, scrapingLogs.id))
        .where(inArray(scrapingLogs.sessionId, sessionIds))
        .all()
        .flatMap((row) => row.id ? [row.id] : [])]));
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
