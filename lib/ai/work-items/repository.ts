import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { sanitizeAIError } from "@/lib/ai/shared/errors";
import { db } from "@/lib/db";
import {
  aiWorkItems,
  jobs,
  matchLogs,
  matchSessionJobs,
  matchSessions,
  scrapingLogs,
  type AIWorkItem,
} from "@/lib/db/schema";
import { chunkSqliteParameters, createSqliteBusyRetry } from "@/lib/db/sqlite-utils";
import type { LocalLeasedWorkStore } from "@/lib/scraper/runtime/leased-work-runner";

import {
  createAIWorkRecords,
  MatchWorkResultSchema,
  parseMatchWorkPayload,
  type CreateAIWorkRecordsInput,
  type MatchWorkPayload,
  type MatchWorkResult,
} from "./contracts";

export interface MatchCheckpoint {
  completedJobIds: number[];
  succeeded: number;
  failed: number;
}

export interface MatchWorkExecutionState {
  checkpoint: MatchCheckpoint;
  completedResult: MatchWorkResult | null;
}

export interface StopMatchSessionResult {
  exists: boolean;
  stopped: boolean;
  status: string | null;
}

export interface AIWorkStore extends LocalLeasedWorkStore<AIWorkItem, number> {
  getExecutionState(sessionId: string, jobIds: number[]): Promise<MatchWorkExecutionState>;
  markQueued(itemId: string, workerId: string, checkpoint: MatchCheckpoint): Promise<boolean>;
  markStarted(
    itemId: string,
    workerId: string,
    checkpoint: MatchCheckpoint,
    now: Date
  ): Promise<boolean>;
  updateProgress(
    itemId: string,
    workerId: string,
    completed: number,
    succeeded: number,
    failed: number
  ): Promise<boolean>;
  stopSession(sessionId: string): Promise<StopMatchSessionResult>;
}

interface CheckpointRow {
  jobId: number | null;
  status: string;
}

function summarizeCheckpoints(rows: CheckpointRow[]): MatchCheckpoint {
  const finalStatusByJob = new Map<number, string>();
  for (const row of rows) {
    if (row.jobId !== null) finalStatusByJob.set(row.jobId, row.status);
  }
  const statuses = Array.from(finalStatusByJob.values());
  return {
    completedJobIds: Array.from(finalStatusByJob.keys()),
    succeeded: statuses.filter((status) => status === "success").length,
    failed: statuses.filter((status) => status !== "success").length,
  };
}

function completedCount(checkpoint: MatchCheckpoint): number {
  return checkpoint.succeeded + checkpoint.failed;
}

function ownedWork(itemId: string, workerId: string) {
  return and(
    eq(aiWorkItems.id, itemId),
    eq(aiWorkItems.workerId, workerId),
    eq(aiWorkItems.status, "running")
  );
}

function terminalSessionStatus(result: MatchWorkResult): "completed" | "failed" {
  return result.total > 0 && result.succeeded === 0 ? "failed" : "completed";
}

function projectScrapingLog(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  payloadJson: string,
  values: Partial<typeof scrapingLogs.$inferInsert>
): void {
  const scrapingLogId = parseMatchWorkPayload(payloadJson).scrapingLogId;
  if (scrapingLogId) {
    tx.update(scrapingLogs).set(values).where(eq(scrapingLogs.id, scrapingLogId)).run();
  }
}

function insertPipelineJobs(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  sessionId: string,
  jobIds: number[],
  now: Date
): void {
  const existingJobIds: number[] = [];
  for (const chunk of chunkSqliteParameters(Array.from(new Set(jobIds)))) {
    existingJobIds.push(...tx.select({ id: jobs.id }).from(jobs)
      .where(inArray(jobs.id, chunk)).all().map((row) => row.id));
  }
  if (existingJobIds.length === 0) return;
  tx.insert(matchSessionJobs).values(existingJobIds.map((jobId) => ({
    sessionId,
    jobId,
    createdAt: now,
    updatedAt: now,
  }))).onConflictDoNothing().run();
}

export function enqueueMatchWork(
  database: typeof db,
  input: Omit<CreateAIWorkRecordsInput, "id" | "now"> & {
    id?: string;
    now?: Date;
  }
): { sessionId: string; status: "queued"; total: number } {
  const id = input.id ?? randomUUID();
  const records = createAIWorkRecords({
    ...input,
    id,
    now: input.now ?? new Date(),
  });
  const now = input.now ?? new Date();
  database.transaction((tx) => {
    tx.insert(matchSessions).values(records.session).run();
    tx.insert(aiWorkItems).values(records.workItem).run();
    insertPipelineJobs(tx, id, input.jobIds, now);
  }, { behavior: "immediate" });
  return { sessionId: id, status: "queued", total: records.session.jobsTotal ?? 0 };
}

export function enqueueCoalescedProfileMatchWork(
  database: typeof db,
  jobIds: number[],
  now = new Date()
): { sessionId: string; status: "queued"; total: number } {
  return database.transaction((tx) => {
    const queued = tx.select({
      id: aiWorkItems.id,
      payloadJson: aiWorkItems.payloadJson,
    }).from(aiWorkItems)
      .innerJoin(matchSessions, eq(matchSessions.id, aiWorkItems.matchSessionId))
      .where(and(
        eq(aiWorkItems.workType, "match_jobs"),
        eq(aiWorkItems.status, "queued"),
        eq(aiWorkItems.cancelRequested, false),
        eq(matchSessions.status, "queued"),
        eq(matchSessions.triggerSource, "profile_update")
      ))
      .orderBy(asc(aiWorkItems.createdAt))
      .limit(1)
      .get();

    if (queued) {
      const payload = parseMatchWorkPayload(queued.payloadJson);
      const mergedJobIds = Array.from(new Set([...payload.jobIds, ...jobIds]));
      const mergedPayload = parseMatchWorkPayload(JSON.stringify({
        ...payload,
        jobIds: mergedJobIds,
      }));
      tx.update(aiWorkItems).set({
        payloadJson: JSON.stringify(mergedPayload),
        updatedAt: now,
      }).where(eq(aiWorkItems.id, queued.id)).run();
      tx.update(matchSessions).set({
        jobsTotal: mergedPayload.jobIds.length,
      }).where(eq(matchSessions.id, queued.id)).run();
      const existingIds = new Set(payload.jobIds);
      const addedJobIds = mergedPayload.jobIds.filter((jobId) => !existingIds.has(jobId));
      if (addedJobIds.length > 0) {
        insertPipelineJobs(tx, queued.id, addedJobIds, now);
      }
      return {
        sessionId: queued.id,
        status: "queued" as const,
        total: mergedPayload.jobIds.length,
      };
    }

    const id = randomUUID();
    const records = createAIWorkRecords({
      id,
      jobIds,
      triggerSource: "profile_update",
      now,
    });
    tx.insert(matchSessions).values(records.session).run();
    tx.insert(aiWorkItems).values(records.workItem).run();
    insertPipelineJobs(tx, id, jobIds, now);
    return {
      sessionId: id,
      status: "queued" as const,
      total: records.session.jobsTotal ?? 0,
    };
  }, { behavior: "immediate" });
}

export function insertCompletedEmptyMatchSession(
  database: typeof db,
  input: {
    triggerSource: MatchWorkPayload["triggerSource"];
    companyId?: number | null;
    id?: string;
    now?: Date;
  }
): { sessionId: string; status: "completed"; total: 0 } {
  const id = input.id ?? randomUUID();
  const now = input.now ?? new Date();
  database.insert(matchSessions).values({
    id,
    triggerSource: input.triggerSource,
    companyId: input.companyId ?? null,
    status: "completed",
    jobsTotal: 0,
    jobsCompleted: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    errorCount: 0,
    startedAt: now,
    completedAt: now,
  }).run();
  return { sessionId: id, status: "completed", total: 0 };
}

export class DrizzleAIWorkStore implements AIWorkStore {
  private readonly retryBusy: ReturnType<typeof createSqliteBusyRetry>;

  constructor(
    private readonly database: typeof db = db,
    config: { busyRetries?: number; busyRetryDelayMs?: number } = {}
  ) {
    this.retryBusy = createSqliteBusyRetry({
      maxRetries: Math.max(0, Math.floor(config.busyRetries ?? 4)),
      baseDelayMs: Math.max(0, config.busyRetryDelayMs ?? 25),
    });
  }

  async claimNext(workerId: string, now: Date, leaseDurationMs: number) {
    return this.retryBusy(() => this.database.transaction((tx) => {
      const candidate = tx.select().from(aiWorkItems).where(and(
        eq(aiWorkItems.workType, "match_jobs"),
        eq(aiWorkItems.status, "queued"),
        eq(aiWorkItems.cancelRequested, false),
        lte(aiWorkItems.availableAt, now)
      )).orderBy(asc(aiWorkItems.priority), asc(aiWorkItems.createdAt)).limit(1).get();
      if (!candidate) return null;
      const claimed = tx.update(aiWorkItems).set({
        status: "running",
        workerId,
        lockedAt: now,
        startedAt: candidate.startedAt ?? now,
        attemptCount: candidate.attemptCount + 1,
        leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
        updatedAt: now,
      }).where(and(
        eq(aiWorkItems.id, candidate.id),
        eq(aiWorkItems.status, "queued"),
        eq(aiWorkItems.cancelRequested, false)
      )).returning().get();
      if (!claimed) return null;
      projectScrapingLog(tx, claimed.payloadJson, { matcherStatus: "in_progress" });
      return claimed;
    }, { behavior: "immediate" }));
  }

  async heartbeat(itemId: string, workerId: string, leaseExpiresAt: Date) {
    const updated = await this.retryBusy(() => this.database.update(aiWorkItems).set({
      leaseExpiresAt,
      updatedAt: new Date(),
    }).where(ownedWork(itemId, workerId)).returning({ id: aiWorkItems.id }));
    return updated.length === 1;
  }

  async isCancellationRequested(itemId: string, workerId: string) {
    const item = await this.database.select({ cancelRequested: aiWorkItems.cancelRequested })
      .from(aiWorkItems).where(ownedWork(itemId, workerId)).limit(1);
    return item.length === 0 || item[0]?.cancelRequested === true;
  }

  async getExecutionState(sessionId: string, jobIds: number[]) {
    if (jobIds.length > 0) {
      const now = new Date();
      await this.database.transaction((tx) => {
        insertPipelineJobs(tx, sessionId, jobIds, now);
      }, { behavior: "immediate" });
    }
    const session = await this.database.select().from(matchSessions)
      .where(eq(matchSessions.id, sessionId)).limit(1).then((rows) => rows[0]);
    if (!session) throw new Error(`Match session ${sessionId} does not exist.`);
    const rows: CheckpointRow[] = [];
    for (const chunk of chunkSqliteParameters(jobIds)) {
      rows.push(...await this.database.select({ jobId: matchLogs.jobId, status: matchLogs.status })
        .from(matchLogs).where(and(
          eq(matchLogs.sessionId, sessionId),
          inArray(matchLogs.jobId, chunk)
        )).orderBy(asc(matchLogs.id)));
    }
    const checkpoint = summarizeCheckpoints(rows);
    const settled = ["completed", "failed", "cancelled"].includes(session.status) &&
      (session.jobsCompleted ?? 0) >= jobIds.length;
    return {
      checkpoint,
      completedResult: settled ? {
        sessionId,
        total: session.jobsTotal ?? jobIds.length,
        succeeded: session.jobsSucceeded ?? 0,
        failed: session.jobsFailed ?? 0,
        duration: 0,
      } : null,
    };
  }

  async markQueued(itemId: string, workerId: string, checkpoint: MatchCheckpoint) {
    return this.updateOwnedProgress(
      itemId,
      workerId,
      "queued",
      completedCount(checkpoint),
      checkpoint.succeeded,
      checkpoint.failed
    );
  }

  async markStarted(
    itemId: string,
    workerId: string,
    checkpoint: MatchCheckpoint,
    now: Date
  ) {
    return this.retryBusy(() => this.database.transaction((tx) => {
      const owned = tx.select({ payloadJson: aiWorkItems.payloadJson })
        .from(aiWorkItems).where(ownedWork(itemId, workerId)).limit(1).get();
      if (!owned) return false;
      const updated = tx.update(matchSessions).set({
        status: "in_progress",
        startedAt: now,
        jobsCompleted: completedCount(checkpoint),
        jobsSucceeded: checkpoint.succeeded,
        jobsFailed: checkpoint.failed,
        errorCount: checkpoint.failed,
      }).where(and(
        eq(matchSessions.id, itemId),
        inArray(matchSessions.status, ["queued", "in_progress"])
      )).returning({ id: matchSessions.id }).get();
      if (!updated) return false;
      projectScrapingLog(tx, owned.payloadJson, {
        matcherStatus: "in_progress",
        matcherJobsCompleted: completedCount(checkpoint),
        matcherErrorCount: checkpoint.failed,
      });
      return true;
    }, { behavior: "immediate" }));
  }

  async updateProgress(
    itemId: string,
    workerId: string,
    completed: number,
    succeeded: number,
    failed: number
  ) {
    return this.updateOwnedProgress(itemId, workerId, "in_progress", completed, succeeded, failed);
  }

  async complete(
    itemId: string,
    workerId: string,
    resultJson: string | null,
    now: Date
  ) {
    const result = MatchWorkResultSchema.parse(resultJson === null ? null : JSON.parse(resultJson));
    if (result.sessionId !== itemId) throw new Error("Matcher returned the wrong session result.");
    return this.retryBusy(() => this.database.transaction((tx) => {
      const updated = tx.update(aiWorkItems).set({
        status: "completed",
        resultJson: JSON.stringify(result),
        workerId: null,
        lockedAt: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        lastError: null,
        completedAt: now,
        updatedAt: now,
      }).where(ownedWork(itemId, workerId)).returning({ payloadJson: aiWorkItems.payloadJson }).get();
      if (!updated) return false;
      const status = terminalSessionStatus(result);
      tx.update(matchSessions).set({
        status,
        jobsCompleted: result.total,
        jobsSucceeded: result.succeeded,
        jobsFailed: result.failed,
        errorCount: result.failed,
        completedAt: now,
      }).where(eq(matchSessions.id, itemId)).run();
      projectScrapingLog(tx, updated.payloadJson, {
        matcherStatus: status,
        matcherJobsCompleted: result.total,
        matcherErrorCount: result.failed,
        matcherDuration: result.duration,
      });
      return true;
    }, { behavior: "immediate" }));
  }

  async release(itemId: string, workerId: string, attemptCount: number, now: Date) {
    return this.requeue(
      itemId,
      workerId,
      null,
      now,
      now,
      Math.max(0, attemptCount - 1)
    );
  }

  async retry(
    itemId: string,
    workerId: string,
    error: string,
    availableAt: Date,
    now: Date
  ) {
    return this.requeue(itemId, workerId, error, availableAt, now);
  }

  async fail(itemId: string, workerId: string, error: string, now: Date) {
    return this.setFailed(itemId, workerId, error, now);
  }

  async cancel(itemId: string, workerId: string, now: Date) {
    return this.setCancelled(itemId, workerId, now);
  }

  async stopSession(sessionId: string): Promise<StopMatchSessionResult> {
    return this.retryBusy(() => this.database.transaction((tx) => {
      const session = tx.select({ status: matchSessions.status }).from(matchSessions)
        .where(eq(matchSessions.id, sessionId)).limit(1).get();
      if (!session) return { exists: false, stopped: false, status: null };
      if (["completed", "failed", "cancelled"].includes(session.status)) {
        return { exists: true, stopped: false, status: session.status };
      }
      const now = new Date();
      const work = tx.select().from(aiWorkItems)
        .where(eq(aiWorkItems.matchSessionId, sessionId)).limit(1).get();
      if (!work) {
        tx.update(matchSessions).set({ status: "cancelled", completedAt: now })
          .where(eq(matchSessions.id, sessionId)).run();
        return { exists: true, stopped: true, status: "cancelled" };
      }
      const checkpoint = summarizeCheckpoints(tx.select({
        jobId: matchLogs.jobId,
        status: matchLogs.status,
      }).from(matchLogs).where(eq(matchLogs.sessionId, sessionId)).all());
      tx.update(aiWorkItems).set({
        status: "cancelled",
        cancelRequested: true,
        workerId: null,
        lockedAt: null,
        leaseExpiresAt: null,
        completedAt: now,
        updatedAt: now,
      }).where(eq(aiWorkItems.id, work.id)).run();
      tx.update(matchSessions).set({
        status: "cancelled",
        jobsCompleted: completedCount(checkpoint),
        jobsSucceeded: checkpoint.succeeded,
        jobsFailed: checkpoint.failed,
        errorCount: checkpoint.failed,
        completedAt: now,
      }).where(eq(matchSessions.id, sessionId)).run();
      projectScrapingLog(tx, work.payloadJson, {
        matcherStatus: "failed",
        matcherJobsCompleted: completedCount(checkpoint),
        matcherErrorCount: checkpoint.failed,
      });
      return { exists: true, stopped: true, status: "cancelled" };
    }, { behavior: "immediate" }));
  }

  async recoverExpired(now: Date) {
    return this.retryBusy(() => this.database.transaction((tx) => {
      const expired = tx.select().from(aiWorkItems).where(and(
        eq(aiWorkItems.workType, "match_jobs"),
        eq(aiWorkItems.status, "running"),
        lte(aiWorkItems.leaseExpiresAt, now)
      )).all();
      for (const item of expired) {
        const checkpoint = summarizeCheckpoints(tx.select({
          jobId: matchLogs.jobId,
          status: matchLogs.status,
        }).from(matchLogs).where(eq(matchLogs.sessionId, item.id)).all());
        const session = tx.select().from(matchSessions)
          .where(eq(matchSessions.id, item.id)).limit(1).get();
        if (session && ["completed", "failed", "cancelled"].includes(session.status)) {
          tx.update(aiWorkItems).set({
            status: session.status === "cancelled" ? "cancelled" : "completed",
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
            completedAt: now,
            updatedAt: now,
          }).where(eq(aiWorkItems.id, item.id)).run();
        } else if (item.cancelRequested) {
          this.cancelRecovered(tx, item, checkpoint, now);
        } else if (item.attemptCount < item.maxAttempts) {
          tx.update(aiWorkItems).set({
            status: "queued",
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
            availableAt: now,
            lastErrorCode: "lease_expired",
            lastError: "Recovered after local AI worker lease expired.",
            updatedAt: now,
          }).where(eq(aiWorkItems.id, item.id)).run();
          tx.update(matchSessions).set({ status: "queued" })
            .where(eq(matchSessions.id, item.id)).run();
          projectScrapingLog(tx, item.payloadJson, { matcherStatus: "pending" });
        } else {
          this.failRecovered(tx, item, checkpoint, now);
        }
      }
      return expired.length;
    }, { behavior: "immediate" }));
  }

  async getNextAvailableAt() {
    const [queued, running] = await Promise.all([
      this.database.select({ at: aiWorkItems.availableAt }).from(aiWorkItems).where(and(
        eq(aiWorkItems.workType, "match_jobs"),
        eq(aiWorkItems.status, "queued"),
        eq(aiWorkItems.cancelRequested, false)
      )).orderBy(asc(aiWorkItems.availableAt)).limit(1),
      this.database.select({ at: aiWorkItems.leaseExpiresAt }).from(aiWorkItems).where(and(
        eq(aiWorkItems.workType, "match_jobs"),
        eq(aiWorkItems.status, "running")
      )).orderBy(asc(aiWorkItems.leaseExpiresAt)).limit(1),
    ]);
    const dates = [queued[0]?.at, running[0]?.at].filter((value): value is Date => value instanceof Date);
    return dates.length ? new Date(Math.min(...dates.map((value) => value.getTime()))) : null;
  }

  private async updateOwnedProgress(
    itemId: string,
    workerId: string,
    status: "queued" | "in_progress",
    completed: number,
    succeeded: number,
    failed: number
  ) {
    return this.retryBusy(() => this.database.transaction((tx) => {
      const owned = tx.select({ payloadJson: aiWorkItems.payloadJson })
        .from(aiWorkItems).where(ownedWork(itemId, workerId)).limit(1).get();
      if (!owned) return false;
      const updated = tx.update(matchSessions).set({
        status,
        jobsCompleted: completed,
        jobsSucceeded: succeeded,
        jobsFailed: failed,
        errorCount: failed,
      }).where(and(
        eq(matchSessions.id, itemId),
        inArray(matchSessions.status, ["queued", "in_progress"])
      )).returning({ id: matchSessions.id }).get();
      if (!updated) return false;
      projectScrapingLog(tx, owned.payloadJson, {
        matcherStatus: status === "queued" ? "pending" : "in_progress",
        matcherJobsCompleted: completed,
        matcherErrorCount: failed,
      });
      return true;
    }, { behavior: "immediate" }));
  }

  private async requeue(
    itemId: string,
    workerId: string,
    error: string | null,
    availableAt: Date,
    now: Date,
    attemptCount?: number
  ) {
    const sanitized = error === null ? null : sanitizeAIError(new Error(error));
    return this.retryBusy(() => this.database.transaction((tx) => {
      const updated = tx.update(aiWorkItems).set({
        status: "queued",
        workerId: null,
        lockedAt: null,
        leaseExpiresAt: null,
        availableAt,
        lastErrorCode: sanitized?.code ?? null,
        lastError: sanitized?.message ?? null,
        updatedAt: now,
        ...(attemptCount === undefined ? {} : { attemptCount }),
      }).where(ownedWork(itemId, workerId)).returning({
        payloadJson: aiWorkItems.payloadJson,
      }).get();
      if (!updated) return false;

      const checkpoint = summarizeCheckpoints(tx.select({
        jobId: matchLogs.jobId,
        status: matchLogs.status,
      }).from(matchLogs).where(eq(matchLogs.sessionId, itemId))
        .orderBy(asc(matchLogs.id)).all());
      tx.update(matchSessions).set({
        status: "queued",
        jobsCompleted: completedCount(checkpoint),
        jobsSucceeded: checkpoint.succeeded,
        jobsFailed: checkpoint.failed,
        errorCount: checkpoint.failed,
      }).where(and(
        eq(matchSessions.id, itemId),
        inArray(matchSessions.status, ["queued", "in_progress"])
      )).run();
      projectScrapingLog(tx, updated.payloadJson, {
        matcherStatus: "pending",
        matcherJobsCompleted: completedCount(checkpoint),
        matcherErrorCount: checkpoint.failed,
      });
      return true;
    }, { behavior: "immediate" }));
  }

  private async setFailed(itemId: string, workerId: string, error: string, now: Date) {
    const sanitized = sanitizeAIError(new Error(error));
    return this.retryBusy(() => this.database.transaction((tx) => {
      const updated = tx.update(aiWorkItems).set({
        status: "failed",
        workerId: null,
        lockedAt: null,
        leaseExpiresAt: null,
        lastErrorCode: sanitized.code,
        lastError: sanitized.message,
        completedAt: now,
        updatedAt: now,
      }).where(ownedWork(itemId, workerId)).returning({ payloadJson: aiWorkItems.payloadJson }).get();
      if (!updated) return false;
      const checkpoint = summarizeCheckpoints(tx.select({
        jobId: matchLogs.jobId,
        status: matchLogs.status,
      }).from(matchLogs).where(eq(matchLogs.sessionId, itemId)).all());
      this.projectTerminalFailure(tx, itemId, updated.payloadJson, checkpoint, now, sanitized.message);
      return true;
    }, { behavior: "immediate" }));
  }

  private async setCancelled(itemId: string, workerId: string, now: Date) {
    return this.retryBusy(() => this.database.transaction((tx) => {
      const updated = tx.update(aiWorkItems).set({
        status: "cancelled",
        cancelRequested: true,
        workerId: null,
        lockedAt: null,
        leaseExpiresAt: null,
        completedAt: now,
        updatedAt: now,
      }).where(ownedWork(itemId, workerId)).returning({ payloadJson: aiWorkItems.payloadJson }).get();
      if (!updated) return false;
      tx.update(matchSessions).set({ status: "cancelled", completedAt: now })
        .where(eq(matchSessions.id, itemId)).run();
      projectScrapingLog(tx, updated.payloadJson, { matcherStatus: "failed" });
      return true;
    }, { behavior: "immediate" }));
  }

  private failRecovered(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    item: AIWorkItem,
    checkpoint: MatchCheckpoint,
    now: Date
  ) {
    tx.update(aiWorkItems).set({
      status: "failed",
      workerId: null,
      lockedAt: null,
      leaseExpiresAt: null,
      lastErrorCode: "attempts_exhausted",
      lastError: "Local AI work exhausted its retry attempts.",
      completedAt: now,
      updatedAt: now,
    }).where(eq(aiWorkItems.id, item.id)).run();
    this.projectTerminalFailure(
      tx,
      item.id,
      item.payloadJson,
      checkpoint,
      now,
      "Local AI work exhausted its retry attempts."
    );
  }

  private cancelRecovered(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    item: AIWorkItem,
    checkpoint: MatchCheckpoint,
    now: Date
  ) {
    tx.update(aiWorkItems).set({
      status: "cancelled",
      workerId: null,
      lockedAt: null,
      leaseExpiresAt: null,
      completedAt: now,
      updatedAt: now,
    }).where(eq(aiWorkItems.id, item.id)).run();
    tx.update(matchSessions).set({
      status: "cancelled",
      jobsCompleted: completedCount(checkpoint),
      jobsSucceeded: checkpoint.succeeded,
      jobsFailed: checkpoint.failed,
      errorCount: checkpoint.failed,
      completedAt: now,
    }).where(eq(matchSessions.id, item.id)).run();
    projectScrapingLog(tx, item.payloadJson, { matcherStatus: "failed" });
  }

  private projectTerminalFailure(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    sessionId: string,
    payloadJson: string,
    checkpoint: MatchCheckpoint,
    now: Date,
    message: string
  ) {
    const payload = parseMatchWorkPayload(payloadJson);
    const pending = payload.jobIds.filter((jobId) => !checkpoint.completedJobIds.includes(jobId));
    for (const chunk of chunkSqliteParameters(pending)) {
      for (const jobId of chunk) {
        tx.insert(matchLogs).values({
          sessionId,
          jobId,
          status: "failed",
          errorType: "queue_failed",
          errorMessage: message,
          completedAt: now,
        }).run();
      }
    }
    const failed = checkpoint.failed + pending.length;
    tx.update(matchSessions).set({
      status: "failed",
      jobsCompleted: checkpoint.succeeded + failed,
      jobsSucceeded: checkpoint.succeeded,
      jobsFailed: failed,
      errorCount: failed,
      completedAt: now,
    }).where(eq(matchSessions.id, sessionId)).run();
    projectScrapingLog(tx, payloadJson, {
      matcherStatus: "failed",
      matcherJobsCompleted: checkpoint.succeeded + failed,
      matcherErrorCount: failed,
    });
  }
}
