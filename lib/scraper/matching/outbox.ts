import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { matchWithTracking } from "@/lib/ai/matcher";
import type { MatchOptions, MatchSessionResult } from "@/lib/ai/matcher/types";
import { db } from "@/lib/db";
import {
  matchLogs,
  matchSessions,
  scrapeMatchOutbox,
  scrapingLogs,
} from "@/lib/db/schema";
import type { ScrapeMatchOutboxItem } from "@/lib/db/schema";
import { createSqliteBusyRetry } from "@/lib/db/sqlite-utils";
import { resolveRetryDelay } from "@/lib/scraper/runtime/retry-policy";
import { ScheduledSingleFlightDispatcher } from "@/lib/scraper/runtime/single-flight-dispatcher";

export interface ScrapeMatchOutboxDispatcherConfig {
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  busyRetries: number;
  busyRetryDelayMs: number;
}

export interface ScrapeMatchOutboxRunSummary {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  recovered: number;
  nextAvailableAt: Date | null;
}

export type ScrapeMatchExecutor = (
  jobIds: number[],
  options: MatchOptions
) => Promise<MatchSessionResult>;

const DEFAULT_CONFIG: ScrapeMatchOutboxDispatcherConfig = {
  leaseDurationMs: 2 * 60 * 1000,
  heartbeatIntervalMs: 15 * 1000,
  baseRetryDelayMs: 5 * 1000,
  maxRetryDelayMs: 5 * 60 * 1000,
  busyRetries: 4,
  busyRetryDelayMs: 25,
};

export class ScrapeMatchOutboxDispatcher {
  private readonly config: ScrapeMatchOutboxDispatcherConfig;
  private readonly retryBusy: ReturnType<typeof createSqliteBusyRetry>;
  private running = false;

  constructor(
    private readonly database: typeof db = db,
    private readonly executeMatch: ScrapeMatchExecutor = matchWithTracking,
    config: Partial<ScrapeMatchOutboxDispatcherConfig> = {}
  ) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    const leaseDurationMs = Math.max(1_000, merged.leaseDurationMs);
    this.config = {
      leaseDurationMs,
      heartbeatIntervalMs: Math.min(
        Math.max(100, merged.heartbeatIntervalMs),
        Math.max(100, Math.floor(leaseDurationMs / 3))
      ),
      baseRetryDelayMs: Math.max(0, merged.baseRetryDelayMs),
      maxRetryDelayMs: Math.max(0, merged.maxRetryDelayMs),
      busyRetries: Math.max(0, Math.floor(merged.busyRetries)),
      busyRetryDelayMs: Math.max(0, merged.busyRetryDelayMs),
    };
    this.retryBusy = createSqliteBusyRetry({
      maxRetries: this.config.busyRetries,
      baseDelayMs: this.config.busyRetryDelayMs,
    });
  }

  async runAvailable(): Promise<ScrapeMatchOutboxRunSummary> {
    if (this.running) throw new Error("The scrape match outbox dispatcher is already active.");
    this.running = true;
    const summary: ScrapeMatchOutboxRunSummary = {
      claimed: 0,
      completed: 0,
      retried: 0,
      failed: 0,
      recovered: 0,
      nextAvailableAt: null,
    };

    try {
      summary.recovered = await this.recoverExpired(new Date());
      const workerId = `match-outbox-${process.pid}-${crypto.randomUUID()}`;

      while (true) {
        const item = await this.claimNext(workerId, new Date());
        if (!item) break;
        summary.claimed += 1;
        await this.executeItem(item, workerId, summary);
      }

      summary.nextAvailableAt = await this.getNextAvailableAt();
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async claimNext(workerId: string, now: Date): Promise<ScrapeMatchOutboxItem | null> {
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
            leaseExpiresAt: new Date(now.getTime() + this.config.leaseDurationMs),
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

  private async executeItem(
    item: ScrapeMatchOutboxItem,
    workerId: string,
    summary: ScrapeMatchOutboxRunSummary
  ): Promise<void> {
    const startedAt = Date.now();
    let leaseLost = false;
    let heartbeatPromise: Promise<void> | null = null;
    let heartbeatStopped = false;
    let progressWriteChain: Promise<void> = Promise.resolve();

    const heartbeatTimer = setInterval(() => {
      if (heartbeatStopped || heartbeatPromise) return;
      const currentHeartbeat = this.renewLease(
        item.id,
        workerId,
        new Date(Date.now() + this.config.leaseDurationMs)
      )
        .then((renewed) => {
          if (!heartbeatStopped && !renewed) leaseLost = true;
        })
        .catch((error) => {
          if (!heartbeatStopped) leaseLost = true;
          console.error("[Matcher Outbox] Lease heartbeat failed:", error);
        });
      heartbeatPromise = currentHeartbeat;
      void currentHeartbeat.finally(() => {
        if (heartbeatPromise === currentHeartbeat) heartbeatPromise = null;
      });
    }, this.config.heartbeatIntervalMs);
    if (typeof heartbeatTimer === "object" && "unref" in heartbeatTimer) {
      heartbeatTimer.unref();
    }

    try {
      const jobIds = this.parseJobIds(item.jobIdsJson);
      const completedSession = await this.getCompletedSessionResult(item.id, jobIds.length);
      const result =
        completedSession ??
        (await this.executeMatch(jobIds, {
          triggerSource: "auto_match",
          companyId: item.companyId,
          sessionId: item.id,
          onProgress: (progress) => {
            progressWriteChain = progressWriteChain
              .then(async () => {
                await this.updateProgress(
                  item.id,
                  workerId,
                  item.scrapingLogId,
                  progress.completed
                );
              })
              .catch((error) =>
                console.error("[Matcher Outbox] Failed to persist progress:", error)
              );
          },
        }));
      if (result.sessionId !== item.id) {
        throw new Error("Matcher returned a result for the wrong durable session.");
      }
      await progressWriteChain;

      heartbeatStopped = true;
      clearInterval(heartbeatTimer);
      await heartbeatPromise;
      if (leaseLost) return;

      const completed = await this.complete(
        item,
        workerId,
        result,
        Date.now() - startedAt,
        new Date()
      );
      if (completed) summary.completed += 1;
    } catch (error) {
      heartbeatStopped = true;
      clearInterval(heartbeatTimer);
      await heartbeatPromise;
      if (leaseLost) return;

      const message = error instanceof Error ? error.message : "Unknown matcher outbox error";
      const now = new Date();
      if (item.attemptCount < item.maxAttempts) {
        const availableAt = new Date(
          now.getTime() +
            resolveRetryDelay(item.attemptCount, error, this.config)
        );
        const retried = await this.retry(item, workerId, message, availableAt, now);
        if (retried) summary.retried += 1;
      } else {
        const failed = await this.fail(item, workerId, message, now);
        if (failed) summary.failed += 1;
      }
    } finally {
      heartbeatStopped = true;
      clearInterval(heartbeatTimer);
      await heartbeatPromise;
    }
  }

  private parseJobIds(value: string): number[] {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      parsed.some((jobId) => !Number.isInteger(jobId) || jobId <= 0)
    ) {
      throw new Error("Matcher outbox contains invalid job IDs.");
    }
    return parsed as number[];
  }

  async renewLease(
    itemId: string,
    workerId: string,
    leaseExpiresAt: Date
  ): Promise<boolean> {
    const updated = await this.retryBusy(() =>
      this.database
        .update(scrapeMatchOutbox)
        .set({ leaseExpiresAt, updatedAt: new Date() })
        .where(
          and(
            eq(scrapeMatchOutbox.id, itemId),
            eq(scrapeMatchOutbox.workerId, workerId),
            eq(scrapeMatchOutbox.status, "running")
          )
        )
        .returning({ id: scrapeMatchOutbox.id })
    );
    return updated.length === 1;
  }

  private async getCompletedSessionResult(
    sessionId: string,
    expectedTotal: number
  ): Promise<MatchSessionResult | null> {
    const rows = await this.retryBusy(() =>
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
    const session = rows[0];
    if (
      !session ||
      (session.status !== "completed" && session.status !== "failed") ||
      (session.completed ?? 0) < expectedTotal
    ) {
      return null;
    }
    return {
      sessionId,
      total: session.total ?? expectedTotal,
      succeeded: session.succeeded ?? 0,
      failed: session.failed ?? 0,
    };
  }

  private async updateProgress(
    itemId: string,
    workerId: string,
    scrapingLogId: number,
    completed: number
  ): Promise<void> {
    await this.retryBusy(() => this.database.transaction((tx) => {
      const owned = tx
        .select({ id: scrapeMatchOutbox.id })
        .from(scrapeMatchOutbox)
        .where(
          and(
            eq(scrapeMatchOutbox.id, itemId),
            eq(scrapeMatchOutbox.workerId, workerId),
            eq(scrapeMatchOutbox.status, "running")
          )
        )
        .limit(1)
        .get();
      if (!owned) return;
      tx.update(scrapingLogs)
        .set({ matcherJobsCompleted: completed })
        .where(eq(scrapingLogs.id, scrapingLogId))
        .run();
    }, { behavior: "immediate" }));
  }

  private async complete(
    item: ScrapeMatchOutboxItem,
    workerId: string,
    result: MatchSessionResult,
    duration: number,
    now: Date
  ): Promise<boolean> {
    return this.retryBusy(() => this.database.transaction((tx) => {
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
        .where(
          and(
            eq(scrapeMatchOutbox.id, item.id),
            eq(scrapeMatchOutbox.workerId, workerId),
            eq(scrapeMatchOutbox.status, "running")
          )
        )
        .returning({ id: scrapeMatchOutbox.id })
        .get();
      if (!updated) return false;

      tx.update(scrapingLogs)
        .set({
          matcherStatus: result.failed === result.total ? "failed" : "completed",
          matcherJobsCompleted: result.total,
          matcherErrorCount: result.failed,
          matcherDuration: duration,
        })
        .where(eq(scrapingLogs.id, item.scrapingLogId))
        .run();
      return true;
    }, { behavior: "immediate" }));
  }

  private async retry(
    item: ScrapeMatchOutboxItem,
    workerId: string,
    error: string,
    availableAt: Date,
    now: Date
  ): Promise<boolean> {
    return this.retryBusy(() => this.database.transaction((tx) => {
      const updated = tx
        .update(scrapeMatchOutbox)
        .set({
          status: "pending",
          workerId: null,
          leaseExpiresAt: null,
          lastError: error,
          availableAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(scrapeMatchOutbox.id, item.id),
            eq(scrapeMatchOutbox.workerId, workerId),
            eq(scrapeMatchOutbox.status, "running")
          )
        )
        .returning({ id: scrapeMatchOutbox.id })
        .get();
      if (!updated) return false;

      tx.update(scrapingLogs)
        .set({ matcherStatus: "pending" })
        .where(eq(scrapingLogs.id, item.scrapingLogId))
        .run();
      return true;
    }, { behavior: "immediate" }));
  }

  private async fail(
    item: ScrapeMatchOutboxItem,
    workerId: string,
    error: string,
    now: Date
  ): Promise<boolean> {
    return this.retryBusy(() => this.database.transaction((tx) => {
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
        .where(
          and(
            eq(scrapeMatchOutbox.id, item.id),
            eq(scrapeMatchOutbox.workerId, workerId),
            eq(scrapeMatchOutbox.status, "running")
          )
        )
        .returning({ id: scrapeMatchOutbox.id })
        .get();
      if (!updated) return false;

      const checkpointLogs = tx
        .select({ jobId: matchLogs.jobId, status: matchLogs.status })
        .from(matchLogs)
        .where(eq(matchLogs.sessionId, item.id))
        .orderBy(asc(matchLogs.id))
        .all();
      const checkpointByJob = new Map<number, string>();
      for (const log of checkpointLogs) {
        if (log.jobId !== null) checkpointByJob.set(log.jobId, log.status);
      }
      const checkpointStatuses = Array.from(checkpointByJob.values());
      const succeeded = checkpointStatuses.filter((status) => status === "success").length;
      const failed = checkpointStatuses.length - succeeded;
      tx.update(scrapingLogs)
        .set({
          matcherStatus: "failed",
          matcherJobsCompleted: checkpointStatuses.length,
          matcherErrorCount: failed,
        })
        .where(eq(scrapingLogs.id, item.scrapingLogId))
        .run();
      tx.update(matchSessions)
        .set({
          status: "failed",
          jobsCompleted: checkpointStatuses.length,
          jobsSucceeded: succeeded,
          jobsFailed: failed,
          errorCount: failed,
          completedAt: now,
        })
        .where(
          and(
            eq(matchSessions.id, item.id),
            inArray(matchSessions.status, ["queued", "in_progress"])
          )
        )
        .run();
      return true;
    }, { behavior: "immediate" }));
  }

  private async recoverExpired(now: Date): Promise<number> {
    return this.retryBusy(() => this.database.transaction((tx) => {
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
      const sessions = tx
        .select({
          id: matchSessions.id,
          status: matchSessions.status,
          total: matchSessions.jobsTotal,
          completed: matchSessions.jobsCompleted,
          succeeded: matchSessions.jobsSucceeded,
          failed: matchSessions.jobsFailed,
        })
        .from(matchSessions)
        .where(inArray(matchSessions.id, expiredIds))
        .all();
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

      if (settled.length > 0) {
        tx.update(scrapeMatchOutbox)
          .set({
            status: "completed",
            workerId: null,
            leaseExpiresAt: null,
            lastError: null,
            completedAt: now,
            updatedAt: now,
          })
          .where(inArray(scrapeMatchOutbox.id, settled.map((item) => item.id)))
          .run();
        for (const item of settled) {
          const session = completedSessions.get(item.id);
          if (!session) continue;
          tx.update(scrapingLogs)
            .set({
              matcherStatus:
                (session.failed ?? 0) === (session.total ?? 0) ? "failed" : "completed",
              matcherJobsCompleted: session.total ?? 0,
              matcherErrorCount: session.failed ?? 0,
            })
            .where(eq(scrapingLogs.id, item.scrapingLogId))
            .run();
        }
      }

      if (retryable.length > 0) {
        tx.update(scrapeMatchOutbox)
          .set({
            status: "pending",
            workerId: null,
            leaseExpiresAt: null,
            availableAt: now,
            lastError: "Recovered after matcher worker lease expired.",
            updatedAt: now,
          })
          .where(inArray(scrapeMatchOutbox.id, retryable.map((item) => item.id)))
          .run();
        tx.update(scrapingLogs)
          .set({ matcherStatus: "pending" })
          .where(inArray(scrapingLogs.id, retryable.map((item) => item.scrapingLogId)))
          .run();
      }

      if (exhausted.length > 0) {
        const exhaustedIds = exhausted.map((item) => item.id);
        tx.update(scrapeMatchOutbox)
          .set({
            status: "failed",
            workerId: null,
            leaseExpiresAt: null,
            completedAt: now,
            lastError: "Matcher worker lease expired after the maximum number of attempts.",
            updatedAt: now,
          })
          .where(inArray(scrapeMatchOutbox.id, exhaustedIds))
          .run();
        tx.update(scrapingLogs)
          .set({ matcherStatus: "failed" })
          .where(inArray(scrapingLogs.id, exhausted.map((item) => item.scrapingLogId)))
          .run();
        const checkpointLogs = tx
          .select({
            sessionId: matchLogs.sessionId,
            jobId: matchLogs.jobId,
            status: matchLogs.status,
          })
          .from(matchLogs)
          .where(inArray(matchLogs.sessionId, exhaustedIds))
          .orderBy(asc(matchLogs.id))
          .all();
        const checkpoints = new Map<string, Map<number, string>>();
        for (const log of checkpointLogs) {
          if (log.sessionId === null || log.jobId === null) continue;
          const jobs = checkpoints.get(log.sessionId) ?? new Map<number, string>();
          jobs.set(log.jobId, log.status);
          checkpoints.set(log.sessionId, jobs);
        }
        for (const item of exhausted) {
          const statuses = Array.from(checkpoints.get(item.id)?.values() ?? []);
          const succeeded = statuses.filter((status) => status === "success").length;
          const failed = statuses.length - succeeded;
          tx.update(matchSessions)
            .set({
              status: "failed",
              jobsCompleted: statuses.length,
              jobsSucceeded: succeeded,
              jobsFailed: failed,
              errorCount: failed,
              completedAt: now,
            })
            .where(
              and(
                eq(matchSessions.id, item.id),
                inArray(matchSessions.status, ["queued", "in_progress"])
              )
            )
            .run();
          tx.update(scrapingLogs)
            .set({
              matcherStatus: "failed",
              matcherJobsCompleted: statuses.length,
              matcherErrorCount: failed,
            })
            .where(eq(scrapingLogs.id, item.scrapingLogId))
            .run();
        }
      }

      return expired.length;
    }, { behavior: "immediate" }));
  }

  private async getNextAvailableAt(): Promise<Date | null> {
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
    const candidates = [pendingItem[0]?.availableAt, runningItem[0]?.leaseExpiresAt].filter(
      (value): value is Date => value instanceof Date
    );
    if (candidates.length === 0) return null;
    return new Date(Math.min(...candidates.map((value) => value.getTime())));
  }

}

const defaultDispatcher = new ScrapeMatchOutboxDispatcher();
const scheduledDispatcher = new ScheduledSingleFlightDispatcher({
  run: () => defaultDispatcher.runAvailable(),
  getNextRunAt: (summary) => summary.nextAvailableAt,
  failureRetryMs: DEFAULT_CONFIG.baseRetryDelayMs,
  onError: (error) => {
    console.error("[Matcher Outbox] Dispatch failed:", error);
  },
});

export function dispatchPendingScrapeMatches(): void {
  void scheduledDispatcher.request();
}

export async function recoverPendingScrapeMatches(): Promise<ScrapeMatchOutboxRunSummary> {
  return scheduledDispatcher.request({ rerunIfActive: false });
}
