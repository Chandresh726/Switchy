import { and, eq, inArray } from "drizzle-orm";

import { parseMatchWorkPayload } from "@/lib/ai/work-items/contracts";
import { db } from "@/lib/db";
import { chunkSqliteParameters } from "@/lib/db/sqlite-utils";
import {
  aiWorkItems,
  companies,
  jobs,
  matchResults,
  matchSessions,
  scrapeMatchOutbox,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";
import {
  getLocalDataOperationGate,
  type LocalDataOperationGate,
} from "@/lib/scraper/runtime/data-operation-gate";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface CompanyDeletionResult {
  deletedCompanies: number;
  deletedJobs: number;
}

export interface LocalDataMaintenance {
  deleteCompanies(companyIds: readonly number[]): Promise<CompanyDeletionResult>;
  deleteCompanyJobs(companyIds: readonly number[]): Promise<number>;
  deleteAllJobs(): Promise<number>;
  deleteMatchHistory(sessionId?: string): Promise<number>;
  deleteMatchData(): Promise<number>;
}

const RESET_MATCHER_PROJECTION = {
  matcherStatus: null,
  matcherJobsTotal: null,
  matcherJobsCompleted: 0,
  matcherDuration: null,
  matcherErrorCount: 0,
} as const;

function normalizedCompanyIds(companyIds: readonly number[]): number[] {
  return Array.from(
    new Set(companyIds.filter((id) => Number.isInteger(id) && id > 0))
  );
}

function findCompanyJobIds(
  database: Database,
  companyIds: readonly number[]
): number[] {
  const jobIds: number[] = [];
  for (const companyBatch of chunkSqliteParameters(companyIds)) {
    jobIds.push(
      ...database
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.companyId, companyBatch))
        .all()
        .map((job) => job.id)
    );
  }
  return jobIds;
}

function findParentScrapeCompanyIds(
  database: Database,
  companyIds: readonly number[]
): number[] {
  const sessionIds = new Set<string>();
  for (const companyBatch of chunkSqliteParameters(companyIds)) {
    for (const item of database
      .selectDistinct({ sessionId: scrapeQueueItems.sessionId })
      .from(scrapeQueueItems)
      .innerJoin(scrapeSessions, eq(scrapeSessions.id, scrapeQueueItems.sessionId))
      .where(
        and(
          inArray(scrapeQueueItems.companyId, companyBatch),
          eq(scrapeSessions.status, "in_progress")
        )
      )
      .all()) {
      sessionIds.add(item.sessionId);
    }
  }

  const affectedCompanyIds = new Set(companyIds);
  for (const sessionBatch of chunkSqliteParameters(Array.from(sessionIds))) {
    for (const item of database
      .selectDistinct({ companyId: scrapeQueueItems.companyId })
      .from(scrapeQueueItems)
      .where(inArray(scrapeQueueItems.sessionId, sessionBatch))
      .all()) {
      affectedCompanyIds.add(item.companyId);
    }
  }
  return Array.from(affectedCompanyIds);
}

function findActiveScrapeSessions(
  tx: Transaction,
  companyIds: readonly number[] | null
): string[] {
  if (companyIds === null) {
    return tx
      .selectDistinct({ sessionId: scrapeQueueItems.sessionId })
      .from(scrapeQueueItems)
      .innerJoin(scrapeSessions, eq(scrapeSessions.id, scrapeQueueItems.sessionId))
      .where(eq(scrapeSessions.status, "in_progress"))
      .all()
      .map((item) => item.sessionId);
  }

  const sessionIds = new Set<string>();
  for (const companyBatch of chunkSqliteParameters(companyIds)) {
    for (const item of tx
      .selectDistinct({ sessionId: scrapeQueueItems.sessionId })
      .from(scrapeQueueItems)
      .innerJoin(scrapeSessions, eq(scrapeSessions.id, scrapeQueueItems.sessionId))
      .where(
        and(
          inArray(scrapeQueueItems.companyId, companyBatch),
          eq(scrapeSessions.status, "in_progress")
        )
      )
      .all()) {
      sessionIds.add(item.sessionId);
    }
  }
  return Array.from(sessionIds);
}

function stopScrapeSessions(
  tx: Transaction,
  sessionIds: readonly string[],
  stoppedAt: Date
): void {
  for (const sessionBatch of chunkSqliteParameters(sessionIds)) {
    tx.update(scrapeQueueItems)
      .set({
        status: "cancelled",
        cancelRequested: true,
        completedAt: stoppedAt,
        updatedAt: stoppedAt,
      })
      .where(
        and(
          inArray(scrapeQueueItems.sessionId, sessionBatch),
          eq(scrapeQueueItems.status, "queued")
        )
      )
      .run();
    tx.update(scrapeQueueItems)
      .set({ cancelRequested: true, updatedAt: stoppedAt })
      .where(
        and(
          inArray(scrapeQueueItems.sessionId, sessionBatch),
          eq(scrapeQueueItems.status, "running")
        )
      )
      .run();
    tx.update(scrapeSessions)
      .set({ status: "failed", completedAt: stoppedAt })
      .where(inArray(scrapeSessions.id, sessionBatch))
      .run();
  }
}

interface OutboxReference {
  sessionId: string;
  scrapingLogId: number;
}

function findOutboxes(
  tx: Transaction,
  companyIds: readonly number[] | null,
  activeOnly: boolean
): OutboxReference[] {
  const scopedLegacy: OutboxReference[] = [];
  if (companyIds === null) {
    scopedLegacy.push(...tx
      .select({
        sessionId: scrapeMatchOutbox.id,
        scrapingLogId: scrapeMatchOutbox.scrapingLogId,
      })
      .from(scrapeMatchOutbox)
      .where(
        activeOnly
          ? inArray(scrapeMatchOutbox.status, ["pending", "running"])
          : undefined
      )
      .all());
  } else {
    for (const companyBatch of chunkSqliteParameters(companyIds)) {
      scopedLegacy.push(
        ...tx
        .select({
          sessionId: scrapeMatchOutbox.id,
          scrapingLogId: scrapeMatchOutbox.scrapingLogId,
        })
        .from(scrapeMatchOutbox)
        .where(
          activeOnly
            ? and(
                inArray(scrapeMatchOutbox.companyId, companyBatch),
                inArray(scrapeMatchOutbox.status, ["pending", "running"])
              )
            : inArray(scrapeMatchOutbox.companyId, companyBatch)
        )
        .all()
      );
    }
  }

  const targetJobIds = companyIds === null ? null : new Set<number>();
  if (companyIds !== null && targetJobIds) {
    for (const companyBatch of chunkSqliteParameters(companyIds)) {
      for (const row of tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(inArray(jobs.companyId, companyBatch))
        .all()) {
        targetJobIds.add(row.id);
      }
    }
  }
  const aiRows = tx.select({
    sessionId: aiWorkItems.matchSessionId,
    scrapingLogId: aiWorkItems.scrapingLogId,
    payloadJson: aiWorkItems.payloadJson,
    status: aiWorkItems.status,
  }).from(aiWorkItems).where(
    activeOnly ? inArray(aiWorkItems.status, ["queued", "running"]) : undefined
  ).all();
  const aiRefs = aiRows.filter((row) => {
    if (companyIds === null) return true;
    const payload = parseMatchWorkPayload(row.payloadJson);
    return payload.jobIds.some((jobId) => targetJobIds?.has(jobId));
  }).flatMap((row) => row.sessionId && row.scrapingLogId
    ? [{ sessionId: row.sessionId, scrapingLogId: row.scrapingLogId }]
    : row.sessionId
      ? [{ sessionId: row.sessionId, scrapingLogId: 0 }]
      : []);
  const bySession = new Map<string, OutboxReference>();
  for (const reference of [...scopedLegacy, ...aiRefs]) {
    const existing = bySession.get(reference.sessionId);
    if (!existing || existing.scrapingLogId === 0) bySession.set(reference.sessionId, reference);
  }
  return Array.from(bySession.values());
}

function resetMatcherProjections(
  tx: Transaction,
  scrapingLogIds: readonly number[]
): void {
  for (const logBatch of chunkSqliteParameters(scrapingLogIds.filter((id) => id > 0))) {
    tx.update(scrapingLogs)
      .set(RESET_MATCHER_PROJECTION)
      .where(inArray(scrapingLogs.id, logBatch))
      .run();
  }
}

function deleteMatchSessions(
  tx: Transaction,
  sessionIds: readonly string[]
): number {
  let deleted = 0;
  for (const sessionBatch of chunkSqliteParameters(sessionIds)) {
    deleted += tx
      .delete(matchSessions)
      .where(inArray(matchSessions.id, sessionBatch))
      .returning({ id: matchSessions.id })
      .all().length;
  }
  return deleted;
}

function terminateMatchWork(
  tx: Transaction,
  companyIds: readonly number[] | null,
  options: { deleteAllOutboxes: boolean; resetProjection: boolean },
  stoppedAt: Date
): void {
  const outboxes = findOutboxes(tx, companyIds, !options.deleteAllOutboxes);
  if (options.resetProjection) {
    resetMatcherProjections(
      tx,
      outboxes.map((outbox) => outbox.scrapingLogId)
    );
  }
  deleteMatchSessions(
    tx,
    outboxes.map((outbox) => outbox.sessionId)
  );

  if (companyIds === null) {
    tx.update(matchSessions)
      .set({ status: "failed", completedAt: stoppedAt })
      .where(inArray(matchSessions.status, ["queued", "in_progress"]))
      .run();
    return;
  }

  for (const companyBatch of chunkSqliteParameters(companyIds)) {
    tx.update(matchSessions)
      .set({ status: "failed", completedAt: stoppedAt })
      .where(
        and(
          inArray(matchSessions.companyId, companyBatch),
          inArray(matchSessions.status, ["queued", "in_progress"])
        )
      )
      .run();
  }
}

function stopScopedWork(
  tx: Transaction,
  companyIds: readonly number[] | null,
  deleteAllOutboxes: boolean
): void {
  const stoppedAt = new Date();
  stopScrapeSessions(tx, findActiveScrapeSessions(tx, companyIds), stoppedAt);
  terminateMatchWork(
    tx,
    companyIds,
    { deleteAllOutboxes, resetProjection: !deleteAllOutboxes },
    stoppedAt
  );
}

export class LocalDataMaintenanceService implements LocalDataMaintenance {
  constructor(
    private readonly database: Database = db,
    private readonly dataOperationGate: LocalDataOperationGate =
      getLocalDataOperationGate()
  ) {}

  async deleteCompanies(
    companyIds: readonly number[]
  ): Promise<CompanyDeletionResult> {
    const ids = normalizedCompanyIds(companyIds);
    if (ids.length === 0) {
      return { deletedCompanies: 0, deletedJobs: 0 };
    }
    const scrapeCompanyIds = findParentScrapeCompanyIds(this.database, ids);
    const jobIds = findCompanyJobIds(this.database, ids);
    this.dataOperationGate.cancelScrapes(scrapeCompanyIds);
    this.dataOperationGate.cancelMatches({ jobIds });

    return this.dataOperationGate.runMaintenance(() =>
      this.database.transaction((tx) => {
        stopScopedWork(tx, ids, true);

        let deletedJobs = 0;
        let deletedCompanies = 0;
        for (const companyBatch of chunkSqliteParameters(ids)) {
          deletedJobs += tx
            .delete(jobs)
            .where(inArray(jobs.companyId, companyBatch))
            .returning({ id: jobs.id })
            .all().length;
          deletedCompanies += tx
            .delete(companies)
            .where(inArray(companies.id, companyBatch))
            .returning({ id: companies.id })
            .all().length;
        }
        return { deletedCompanies, deletedJobs };
      }, { behavior: "immediate" })
    );
  }

  async deleteCompanyJobs(companyIds: readonly number[]): Promise<number> {
    const ids = normalizedCompanyIds(companyIds);
    if (ids.length === 0) return 0;
    const scrapeCompanyIds = findParentScrapeCompanyIds(this.database, ids);
    const jobIds = findCompanyJobIds(this.database, ids);
    this.dataOperationGate.cancelScrapes(scrapeCompanyIds);
    this.dataOperationGate.cancelMatches({ jobIds });

    return this.dataOperationGate.runMaintenance(() =>
      this.database.transaction((tx) => {
        stopScopedWork(tx, ids, false);
        let deleted = 0;
        for (const companyBatch of chunkSqliteParameters(ids)) {
          deleted += tx
            .delete(jobs)
            .where(inArray(jobs.companyId, companyBatch))
            .returning({ id: jobs.id })
            .all().length;
        }
        return deleted;
      }, { behavior: "immediate" })
    );
  }

  async deleteAllJobs(): Promise<number> {
    this.dataOperationGate.cancelScrapes();
    this.dataOperationGate.cancelMatches();
    return this.dataOperationGate.runMaintenance(() =>
      this.database.transaction((tx) => {
        stopScopedWork(tx, null, false);
        return tx.delete(jobs).returning({ id: jobs.id }).all().length;
      }, { behavior: "immediate" })
    );
  }

  async deleteMatchHistory(sessionId?: string): Promise<number> {
    this.dataOperationGate.cancelMatches(
      sessionId ? { sessionId } : { trackedOnly: true }
    );
    return this.dataOperationGate.runMaintenance(() =>
      this.database.transaction((tx) => {
        const outboxes = findOutboxes(tx, null, false);
        const scopedOutboxes = sessionId
          ? outboxes.filter((outbox) => outbox.sessionId === sessionId)
          : outboxes;
        resetMatcherProjections(
          tx,
          scopedOutboxes.map((outbox) => outbox.scrapingLogId)
        );

        if (sessionId) {
          return deleteMatchSessions(tx, [sessionId]);
        }
        return tx
          .delete(matchSessions)
          .returning({ id: matchSessions.id })
          .all().length;
      }, { behavior: "immediate" })
    );
  }

  async deleteMatchData(): Promise<number> {
    this.dataOperationGate.cancelMatches();
    return this.dataOperationGate.runMaintenance(() =>
      this.database.transaction((tx) => {
        const outboxes = findOutboxes(tx, null, false);
        resetMatcherProjections(
          tx,
          outboxes.map((outbox) => outbox.scrapingLogId)
        );
        const matchedJobIds = tx
          .selectDistinct({ jobId: matchResults.jobId })
          .from(matchResults)
          .all();
        tx.delete(matchSessions).run();
        tx.delete(matchResults).run();
        return matchedJobIds.length;
      }, { behavior: "immediate" })
    );
  }
}

let defaultMaintenanceService: LocalDataMaintenance | null = null;

export function getLocalDataMaintenanceService(): LocalDataMaintenance {
  if (!defaultMaintenanceService) {
    defaultMaintenanceService = new LocalDataMaintenanceService();
  }
  return defaultMaintenanceService;
}
