import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  matchLogs,
  matchSessions,
  scrapeMatchOutbox,
  scrapingLogs,
} from "@/lib/db/schema";
import type { ScrapeMatchOutboxItem } from "@/lib/db/schema";
import { chunkSqliteParameters, createSqliteBusyRetry } from "@/lib/db/sqlite-utils";
import type { LocalLeasedWorkStore } from "@/lib/scraper/runtime/leased-work-runner";

import {
  MatchWorkResultSchema,
  type MatchWorkResult,
} from "./work-contracts";

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

export interface MatchWorkStore
  extends LocalLeasedWorkStore<ScrapeMatchOutboxItem, number> {
  getExecutionState(sessionId: string, jobIds: number[]): Promise<MatchWorkExecutionState>;
  markQueued(
    itemId: string,
    workerId: string,
    checkpoint: MatchCheckpoint
  ): Promise<boolean>;
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

export interface DrizzleMatchWorkStoreConfig {
  busyRetries: number;
  busyRetryDelayMs: number;
}

const DEFAULT_CONFIG: DrizzleMatchWorkStoreConfig = {
  busyRetries: 4,
  busyRetryDelayMs: 25,
};

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

function checkpointCompleted(checkpoint: MatchCheckpoint): number {
  return checkpoint.succeeded + checkpoint.failed;
}

function ownedWork(itemId: string, workerId: string) {
  return and(
    eq(scrapeMatchOutbox.id, itemId),
    eq(scrapeMatchOutbox.workerId, workerId),
    eq(scrapeMatchOutbox.status, "running")
  );
}

export class DrizzleMatchWorkStore implements MatchWorkStore {
  private readonly retryBusy: ReturnType<typeof createSqliteBusyRetry>;

  constructor(
    private readonly database: typeof db = db,
    config: Partial<DrizzleMatchWorkStoreConfig> = {}
  ) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.retryBusy = createSqliteBusyRetry({
      maxRetries: Math.max(0, Math.floor(merged.busyRetries)),
      baseDelayMs: Math.max(0, merged.busyRetryDelayMs),
    });
  }

  async claimNext(
    workerId: string,
    now: Date,
    leaseDurationMs: number
  ): Promise<ScrapeMatchOutboxItem | null> {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const candidate = tx
          .select()
          .from(scrapeMatchOutbox)
          .where(
            and(
              eq(scrapeMatchOutbox.status, "pending"),
              lte(scrapeMatchOutbox.availableAt, now)
            )
          )
          .orderBy(asc(scrapeMatchOutbox.createdAt))
          .limit(1)
          .get();
        if (!candidate) return null;

        const claimed = tx
          .update(scrapeMatchOutbox)
          .set({
            status: "running",
            workerId,
            attemptCount: candidate.attemptCount + 1,
            leaseExpiresAt: new Date(now.getTime() + leaseDurationMs),
            updatedAt: now,
          })
          .where(
            and(
              eq(scrapeMatchOutbox.id, candidate.id),
              eq(scrapeMatchOutbox.status, "pending")
            )
          )
          .returning()
          .get();
        if (!claimed) return null;

        tx.update(scrapingLogs)
          .set({ matcherStatus: "in_progress" })
          .where(eq(scrapingLogs.id, claimed.scrapingLogId))
          .run();
        return claimed;
      }, { behavior: "immediate" })
    );
  }

  async heartbeat(
    itemId: string,
    workerId: string,
    leaseExpiresAt: Date
  ): Promise<boolean> {
    const updated = await this.retryBusy(() =>
      this.database
        .update(scrapeMatchOutbox)
        .set({ leaseExpiresAt, updatedAt: new Date() })
        .where(ownedWork(itemId, workerId))
        .returning({ id: scrapeMatchOutbox.id })
    );
    return updated.length === 1;
  }

  async isCancellationRequested(itemId: string, workerId: string): Promise<boolean> {
    const owned = await this.database
      .select({ id: scrapeMatchOutbox.id })
      .from(scrapeMatchOutbox)
      .where(ownedWork(itemId, workerId))
      .limit(1);
    return owned.length === 0;
  }

  async getExecutionState(
    sessionId: string,
    jobIds: number[]
  ): Promise<MatchWorkExecutionState> {
    const [session] = await this.retryBusy(() =>
      this.database
        .select({
          status: matchSessions.status,
          total: matchSessions.jobsTotal,
          completed: matchSessions.jobsCompleted,
          succeeded: matchSessions.jobsSucceeded,
          failed: matchSessions.jobsFailed,
        })
        .from(matchSessions)
        .where(eq(matchSessions.id, sessionId))
        .limit(1)
    );
    if (!session) throw new Error(`Match session ${sessionId} does not exist.`);

    const checkpointRows: CheckpointRow[] = [];
    for (const jobIdChunk of chunkSqliteParameters(jobIds)) {
      checkpointRows.push(
        ...(await this.retryBusy(() =>
          this.database
            .select({ jobId: matchLogs.jobId, status: matchLogs.status })
            .from(matchLogs)
            .where(
              and(
                eq(matchLogs.sessionId, sessionId),
                inArray(matchLogs.jobId, jobIdChunk)
              )
            )
            .orderBy(asc(matchLogs.id))
        ))
      );
    }
    const checkpoint = summarizeCheckpoints(checkpointRows);
    const isSettled =
      (session.status === "completed" || session.status === "failed") &&
      (session.completed ?? 0) >= jobIds.length;

    return {
      checkpoint,
      completedResult: isSettled
        ? {
            sessionId,
            total: session.total ?? jobIds.length,
            succeeded: session.succeeded ?? 0,
            failed: session.failed ?? 0,
            duration: 0,
          }
        : null,
    };
  }

  async markQueued(
    itemId: string,
    workerId: string,
    checkpoint: MatchCheckpoint
  ): Promise<boolean> {
    return this.updateOwnedProgress(
      itemId,
      workerId,
      "queued",
      checkpointCompleted(checkpoint),
      checkpoint.succeeded,
      checkpoint.failed
    );
  }

  async markStarted(
    itemId: string,
    workerId: string,
    checkpoint: MatchCheckpoint,
    now: Date
  ): Promise<boolean> {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const owned = tx
          .select({ scrapingLogId: scrapeMatchOutbox.scrapingLogId })
          .from(scrapeMatchOutbox)
          .where(ownedWork(itemId, workerId))
          .limit(1)
          .get();
        if (!owned) return false;

        const started = tx
          .update(matchSessions)
          .set({
            status: "in_progress",
            startedAt: now,
            jobsCompleted: checkpointCompleted(checkpoint),
            jobsSucceeded: checkpoint.succeeded,
            jobsFailed: checkpoint.failed,
            errorCount: checkpoint.failed,
          })
          .where(
            and(
              eq(matchSessions.id, itemId),
              inArray(matchSessions.status, ["queued", "in_progress"])
            )
          )
          .returning({ id: matchSessions.id })
          .get();
        if (!started) return false;

        tx.update(scrapingLogs)
          .set({
            matcherStatus: "in_progress",
            matcherJobsCompleted: checkpointCompleted(checkpoint),
            matcherErrorCount: checkpoint.failed,
          })
          .where(eq(scrapingLogs.id, owned.scrapingLogId))
          .run();
        return true;
      }, { behavior: "immediate" })
    );
  }

  async updateProgress(
    itemId: string,
    workerId: string,
    completed: number,
    succeeded: number,
    failed: number
  ): Promise<boolean> {
    return this.updateOwnedProgress(
      itemId,
      workerId,
      "in_progress",
      completed,
      succeeded,
      failed
    );
  }

  async complete(
    itemId: string,
    workerId: string,
    resultJson: string | null,
    now: Date
  ): Promise<boolean> {
    const parsed = MatchWorkResultSchema.safeParse(
      resultJson === null ? null : JSON.parse(resultJson)
    );
    if (!parsed.success || parsed.data.sessionId !== itemId) {
      throw new Error("Matcher produced an invalid durable work result.");
    }
    const result = parsed.data;

    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const updated = tx
          .update(scrapeMatchOutbox)
          .set({
            status: "completed",
            workerId: null,
            leaseExpiresAt: null,
            lastError: null,
            completedAt: now,
            updatedAt: now,
          })
          .where(ownedWork(itemId, workerId))
          .returning({ scrapingLogId: scrapeMatchOutbox.scrapingLogId })
          .get();
        if (!updated) return false;

        const status = result.failed === result.total ? "failed" : "completed";
        tx.update(matchSessions)
          .set({
            status,
            jobsCompleted: result.total,
            jobsSucceeded: result.succeeded,
            jobsFailed: result.failed,
            errorCount: result.failed,
            completedAt: now,
          })
          .where(
            and(
              eq(matchSessions.id, itemId),
              inArray(matchSessions.status, ["queued", "in_progress"])
            )
          )
          .run();
        tx.update(scrapingLogs)
          .set({
            matcherStatus: status,
            matcherJobsCompleted: result.total,
            matcherErrorCount: result.failed,
            matcherDuration: result.duration,
          })
          .where(eq(scrapingLogs.id, updated.scrapingLogId))
          .run();
        return true;
      }, { behavior: "immediate" })
    );
  }

  async release(
    itemId: string,
    workerId: string,
    attemptCount: number,
    now: Date
  ): Promise<boolean> {
    return this.requeue(itemId, workerId, null, now, now, Math.max(0, attemptCount - 1));
  }

  async retry(
    itemId: string,
    workerId: string,
    error: string,
    availableAt: Date,
    now: Date
  ): Promise<boolean> {
    return this.requeue(itemId, workerId, error, availableAt, now);
  }

  async fail(
    itemId: string,
    workerId: string,
    error: string,
    now: Date
  ): Promise<boolean> {
    return this.finishFailed(itemId, workerId, error, now);
  }

  async cancel(itemId: string, workerId: string, now: Date): Promise<boolean> {
    return this.finishFailed(itemId, workerId, "Matching was cancelled.", now);
  }

  async stopSession(sessionId: string): Promise<StopMatchSessionResult> {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const session = tx
          .select({ status: matchSessions.status })
          .from(matchSessions)
          .where(eq(matchSessions.id, sessionId))
          .limit(1)
          .get();
        if (!session) return { exists: false, stopped: false, status: null };
        if (session.status !== "queued" && session.status !== "in_progress") {
          return { exists: true, stopped: false, status: session.status };
        }

        const checkpoint = summarizeCheckpoints(
          tx.select({ jobId: matchLogs.jobId, status: matchLogs.status })
            .from(matchLogs)
            .where(eq(matchLogs.sessionId, sessionId))
            .orderBy(asc(matchLogs.id))
            .all()
        );
        const stoppedAt = new Date();
        const stopped = tx
          .update(matchSessions)
          .set({
            status: "failed",
            jobsCompleted: checkpointCompleted(checkpoint),
            jobsSucceeded: checkpoint.succeeded,
            jobsFailed: checkpoint.failed,
            errorCount: checkpoint.failed,
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
              matcherJobsCompleted: checkpointCompleted(checkpoint),
              matcherErrorCount: checkpoint.failed,
            })
            .where(eq(scrapingLogs.id, outbox.scrapingLogId))
            .run();
        }
        return { exists: true, stopped: true, status: "failed" };
      }, { behavior: "immediate" })
    );
  }

  async recoverExpired(now: Date): Promise<number> {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const expired = tx
          .select()
          .from(scrapeMatchOutbox)
          .where(
            and(
              eq(scrapeMatchOutbox.status, "running"),
              lte(scrapeMatchOutbox.leaseExpiresAt, now)
            )
          )
          .all();
        if (expired.length === 0) return 0;

        const expiredIds = expired.map((item) => item.id);
        const sessions: Array<{
          id: string;
          status: string;
          total: number | null;
          completed: number | null;
          succeeded: number | null;
          failed: number | null;
        }> = [];
        for (const sessionIdChunk of chunkSqliteParameters(expiredIds)) {
          sessions.push(
            ...tx
              .select({
                id: matchSessions.id,
                status: matchSessions.status,
                total: matchSessions.jobsTotal,
                completed: matchSessions.jobsCompleted,
                succeeded: matchSessions.jobsSucceeded,
                failed: matchSessions.jobsFailed,
              })
              .from(matchSessions)
              .where(inArray(matchSessions.id, sessionIdChunk))
              .all()
          );
        }
        const completedSessions = new Map(
          sessions
            .filter(
              (session) =>
                (session.status === "completed" || session.status === "failed") &&
                (session.completed ?? 0) >= (session.total ?? 0)
            )
            .map((session) => [session.id, session])
        );
        const settled = expired.filter((item) => completedSessions.has(item.id));
        const unsettled = expired.filter((item) => !completedSessions.has(item.id));
        const retryable = unsettled.filter((item) => item.attemptCount < item.maxAttempts);
        const exhausted = unsettled.filter((item) => item.attemptCount >= item.maxAttempts);

        for (const item of settled) {
          const session = completedSessions.get(item.id);
          if (!session) continue;
          tx.update(scrapeMatchOutbox)
            .set({
              status: "completed",
              workerId: null,
              leaseExpiresAt: null,
              lastError: null,
              completedAt: now,
              updatedAt: now,
            })
            .where(eq(scrapeMatchOutbox.id, item.id))
            .run();
          tx.update(scrapingLogs)
            .set({
              matcherStatus:
                (session.failed ?? 0) === (session.total ?? 0)
                  ? "failed"
                  : "completed",
              matcherJobsCompleted: session.total ?? 0,
              matcherErrorCount: session.failed ?? 0,
            })
            .where(eq(scrapingLogs.id, item.scrapingLogId))
            .run();
        }

        for (const item of retryable) {
          tx.update(scrapeMatchOutbox)
            .set({
              status: "pending",
              workerId: null,
              leaseExpiresAt: null,
              availableAt: now,
              lastError: "Recovered after matcher worker lease expired.",
              updatedAt: now,
            })
            .where(eq(scrapeMatchOutbox.id, item.id))
            .run();
          tx.update(matchSessions)
            .set({ status: "queued" })
            .where(
              and(
                eq(matchSessions.id, item.id),
                inArray(matchSessions.status, ["queued", "in_progress"])
              )
            )
            .run();
          tx.update(scrapingLogs)
            .set({ matcherStatus: "pending" })
            .where(eq(scrapingLogs.id, item.scrapingLogId))
            .run();
        }

        for (const item of exhausted) {
          const checkpoint = summarizeCheckpoints(
            tx.select({ jobId: matchLogs.jobId, status: matchLogs.status })
              .from(matchLogs)
              .where(eq(matchLogs.sessionId, item.id))
              .orderBy(asc(matchLogs.id))
              .all()
          );
          this.failRecoveredItem(tx, item, checkpoint, now);
        }

        return expired.length;
      }, { behavior: "immediate" })
    );
  }

  async getNextAvailableAt(): Promise<Date | null> {
    const [pendingItem, runningItem] = await Promise.all([
      this.database
        .select({ availableAt: scrapeMatchOutbox.availableAt })
        .from(scrapeMatchOutbox)
        .where(eq(scrapeMatchOutbox.status, "pending"))
        .orderBy(asc(scrapeMatchOutbox.availableAt))
        .limit(1),
      this.database
        .select({ leaseExpiresAt: scrapeMatchOutbox.leaseExpiresAt })
        .from(scrapeMatchOutbox)
        .where(eq(scrapeMatchOutbox.status, "running"))
        .orderBy(asc(scrapeMatchOutbox.leaseExpiresAt))
        .limit(1),
    ]);
    const candidates = [
      pendingItem[0]?.availableAt,
      runningItem[0]?.leaseExpiresAt,
    ].filter((value): value is Date => value instanceof Date);
    if (candidates.length === 0) return null;
    return new Date(Math.min(...candidates.map((value) => value.getTime())));
  }

  private async updateOwnedProgress(
    itemId: string,
    workerId: string,
    status: "queued" | "in_progress",
    completed: number,
    succeeded: number,
    failed: number
  ): Promise<boolean> {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const owned = tx
          .select({ scrapingLogId: scrapeMatchOutbox.scrapingLogId })
          .from(scrapeMatchOutbox)
          .where(ownedWork(itemId, workerId))
          .limit(1)
          .get();
        if (!owned) return false;

        const updated = tx
          .update(matchSessions)
          .set({
            status,
            jobsCompleted: completed,
            jobsSucceeded: succeeded,
            jobsFailed: failed,
            errorCount: failed,
          })
          .where(
            and(
              eq(matchSessions.id, itemId),
              inArray(matchSessions.status, ["queued", "in_progress"])
            )
          )
          .returning({ id: matchSessions.id })
          .get();
        if (!updated) return false;

        tx.update(scrapingLogs)
          .set({ matcherJobsCompleted: completed, matcherErrorCount: failed })
          .where(eq(scrapingLogs.id, owned.scrapingLogId))
          .run();
        return true;
      }, { behavior: "immediate" })
    );
  }

  private async requeue(
    itemId: string,
    workerId: string,
    error: string | null,
    availableAt: Date,
    now: Date,
    attemptCount?: number
  ): Promise<boolean> {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const updated = tx
          .update(scrapeMatchOutbox)
          .set({
            status: "pending",
            workerId: null,
            leaseExpiresAt: null,
            lastError: error,
            availableAt,
            updatedAt: now,
            ...(attemptCount === undefined ? {} : { attemptCount }),
          })
          .where(ownedWork(itemId, workerId))
          .returning({ scrapingLogId: scrapeMatchOutbox.scrapingLogId })
          .get();
        if (!updated) return false;

        const checkpoint = summarizeCheckpoints(
          tx.select({ jobId: matchLogs.jobId, status: matchLogs.status })
            .from(matchLogs)
            .where(eq(matchLogs.sessionId, itemId))
            .orderBy(asc(matchLogs.id))
            .all()
        );
        tx.update(matchSessions)
          .set({
            status: "queued",
            jobsCompleted: checkpointCompleted(checkpoint),
            jobsSucceeded: checkpoint.succeeded,
            jobsFailed: checkpoint.failed,
            errorCount: checkpoint.failed,
          })
          .where(
            and(
              eq(matchSessions.id, itemId),
              inArray(matchSessions.status, ["queued", "in_progress"])
            )
          )
          .run();
        tx.update(scrapingLogs)
          .set({
            matcherStatus: "pending",
            matcherJobsCompleted: checkpointCompleted(checkpoint),
            matcherErrorCount: checkpoint.failed,
          })
          .where(eq(scrapingLogs.id, updated.scrapingLogId))
          .run();
        return true;
      }, { behavior: "immediate" })
    );
  }

  private async finishFailed(
    itemId: string,
    workerId: string,
    error: string,
    now: Date
  ): Promise<boolean> {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const updated = tx
          .update(scrapeMatchOutbox)
          .set({
            status: "failed",
            workerId: null,
            leaseExpiresAt: null,
            lastError: error,
            completedAt: now,
            updatedAt: now,
          })
          .where(ownedWork(itemId, workerId))
          .returning({ scrapingLogId: scrapeMatchOutbox.scrapingLogId })
          .get();
        if (!updated) return false;

        const checkpoint = summarizeCheckpoints(
          tx.select({ jobId: matchLogs.jobId, status: matchLogs.status })
            .from(matchLogs)
            .where(eq(matchLogs.sessionId, itemId))
            .orderBy(asc(matchLogs.id))
            .all()
        );
        this.projectFailure(
          tx,
          itemId,
          updated.scrapingLogId,
          checkpoint,
          now
        );
        return true;
      }, { behavior: "immediate" })
    );
  }

  private projectFailure(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    itemId: string,
    scrapingLogId: number,
    checkpoint: MatchCheckpoint,
    now: Date
  ): void {
    tx.update(matchSessions)
      .set({
        status: "failed",
        jobsCompleted: checkpointCompleted(checkpoint),
        jobsSucceeded: checkpoint.succeeded,
        jobsFailed: checkpoint.failed,
        errorCount: checkpoint.failed,
        completedAt: now,
      })
      .where(
        and(
          eq(matchSessions.id, itemId),
          inArray(matchSessions.status, ["queued", "in_progress"])
        )
      )
      .run();
    tx.update(scrapingLogs)
      .set({
        matcherStatus: "failed",
        matcherJobsCompleted: checkpointCompleted(checkpoint),
        matcherErrorCount: checkpoint.failed,
      })
      .where(eq(scrapingLogs.id, scrapingLogId))
      .run();
  }

  private failRecoveredItem(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    item: ScrapeMatchOutboxItem,
    checkpoint: MatchCheckpoint,
    now: Date
  ): void {
    tx.update(scrapeMatchOutbox)
      .set({
        status: "failed",
        workerId: null,
        leaseExpiresAt: null,
        completedAt: now,
        lastError: "Matcher worker lease expired after the maximum number of attempts.",
        updatedAt: now,
      })
      .where(eq(scrapeMatchOutbox.id, item.id))
      .run();
    this.projectFailure(tx, item.id, item.scrapingLogId, checkpoint, now);
  }
}
