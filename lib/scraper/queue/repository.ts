import { and, asc, eq, gte, isNotNull, lt, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { scrapeQueueItems, scrapeSessions } from "@/lib/db/schema";
import { createSqliteBusyRetry } from "@/lib/db/sqlite-utils";

import type {
  EnqueueScrapeSession,
  ILocalScrapeQueueRepository,
  QueueCancellationResult,
  QueueRecoveryResult,
} from "./types";

export interface DrizzleLocalScrapeQueueRepositoryConfig {
  claimBusyRetries: number;
  claimBusyRetryDelayMs: number;
}

const DEFAULT_REPOSITORY_CONFIG: DrizzleLocalScrapeQueueRepositoryConfig = {
  claimBusyRetries: 4,
  claimBusyRetryDelayMs: 25,
};

export class DrizzleLocalScrapeQueueRepository implements ILocalScrapeQueueRepository {
  private readonly config: DrizzleLocalScrapeQueueRepositoryConfig;
  private readonly retryBusy: ReturnType<typeof createSqliteBusyRetry>;

  constructor(
    private readonly database: typeof db = db,
    config: Partial<DrizzleLocalScrapeQueueRepositoryConfig> = {}
  ) {
    const merged = { ...DEFAULT_REPOSITORY_CONFIG, ...config };
    this.config = {
      claimBusyRetries: Math.max(0, Math.floor(merged.claimBusyRetries)),
      claimBusyRetryDelayMs: Math.max(0, merged.claimBusyRetryDelayMs),
    };
    this.retryBusy = createSqliteBusyRetry({
      maxRetries: this.config.claimBusyRetries,
      baseDelayMs: this.config.claimBusyRetryDelayMs,
    });
  }

  async createSessionAndEnqueue(input: EnqueueScrapeSession) {
    const now = new Date();
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        tx.insert(scrapeSessions)
          .values({
            id: input.sessionId,
            triggerSource: input.triggerSource,
            status: input.companyIds.length > 0 ? "in_progress" : "completed",
            companiesTotal: input.companyIds.length,
            companiesCompleted: 0,
            totalJobsFound: 0,
            totalJobsAdded: 0,
            totalJobsFiltered: 0,
            totalJobsArchived: 0,
            startedAt: now,
            completedAt: input.companyIds.length > 0 ? null : now,
          })
          .run();
        if (input.companyIds.length === 0) return [];

        return tx
          .insert(scrapeQueueItems)
          .values(
            input.companyIds.map((companyId, index) => ({
              id: crypto.randomUUID(),
              sessionId: input.sessionId,
              companyId,
              status: "queued",
              priority: (input.priority ?? 100) + index,
              maxAttempts: input.maxAttempts ?? 3,
              availableAt: input.availableAt ?? now,
              createdAt: now,
              updatedAt: now,
            }))
          )
          .returning()
          .all();
      }, { behavior: "immediate" })
    );
  }

  async claimNext(workerId: string, now: Date, leaseDurationMs: number) {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const candidate = tx
          .select()
          .from(scrapeQueueItems)
          .where(
            and(
              eq(scrapeQueueItems.status, "queued"),
              eq(scrapeQueueItems.cancelRequested, false),
              lte(scrapeQueueItems.availableAt, now)
            )
          )
          .orderBy(
            asc(scrapeQueueItems.priority),
            asc(scrapeQueueItems.createdAt),
            asc(scrapeQueueItems.id)
          )
          .limit(1)
          .get();

        if (!candidate) return null;
        const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
        return tx
          .update(scrapeQueueItems)
          .set({
            status: "running",
            workerId,
            lockedAt: now,
            leaseExpiresAt,
            startedAt: candidate.startedAt ?? now,
            attemptCount: candidate.attemptCount + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(scrapeQueueItems.id, candidate.id),
              eq(scrapeQueueItems.status, "queued"),
              eq(scrapeQueueItems.cancelRequested, false)
            )
          )
          .returning()
          .get() ?? null;
      }, { behavior: "immediate" })
    );
  }

  async heartbeat(itemId: string, workerId: string, leaseExpiresAt: Date): Promise<boolean> {
    const updated = await this.retryBusy(() =>
      this.database
        .update(scrapeQueueItems)
        .set({ leaseExpiresAt, updatedAt: new Date() })
        .where(
          and(
            eq(scrapeQueueItems.id, itemId),
            eq(scrapeQueueItems.workerId, workerId),
            eq(scrapeQueueItems.status, "running"),
            eq(scrapeQueueItems.cancelRequested, false)
          )
        )
        .returning({ id: scrapeQueueItems.id })
    );
    return updated.length === 1;
  }

  async isCancellationRequested(itemId: string, workerId: string): Promise<boolean> {
    const item = await this.database
      .select({ cancelRequested: scrapeQueueItems.cancelRequested })
      .from(scrapeQueueItems)
      .where(
        and(
          eq(scrapeQueueItems.id, itemId),
          eq(scrapeQueueItems.workerId, workerId),
          eq(scrapeQueueItems.status, "running")
        )
      )
      .limit(1);
    return item[0]?.cancelRequested ?? true;
  }

  async complete(
    itemId: string,
    workerId: string,
    resultJson: string | null,
    now: Date
  ): Promise<boolean> {
    return this.finishOwnedItem(itemId, workerId, {
      status: "completed",
      resultJson,
      completedAt: now,
      updatedAt: now,
    }, true);
  }

  async retry(
    itemId: string,
    workerId: string,
    error: string,
    availableAt: Date,
    now: Date
  ): Promise<boolean> {
    return this.finishOwnedItem(itemId, workerId, {
      status: "queued",
      workerId: null,
      lockedAt: null,
      leaseExpiresAt: null,
      availableAt,
      lastError: error,
      updatedAt: now,
    }, true);
  }

  async release(
    itemId: string,
    workerId: string,
    attemptCount: number,
    now: Date
  ): Promise<boolean> {
    return this.finishOwnedItem(itemId, workerId, {
      status: "queued",
      workerId: null,
      lockedAt: null,
      leaseExpiresAt: null,
      attemptCount: Math.max(0, attemptCount - 1),
      availableAt: now,
      lastError: null,
      updatedAt: now,
    }, true);
  }

  async fail(itemId: string, workerId: string, error: string, now: Date): Promise<boolean> {
    return this.finishOwnedItem(itemId, workerId, {
      status: "failed",
      lastError: error,
      completedAt: now,
      updatedAt: now,
    }, true);
  }

  async cancel(itemId: string, workerId: string, now: Date): Promise<boolean> {
    return this.finishOwnedItem(itemId, workerId, {
      status: "cancelled",
      cancelRequested: true,
      completedAt: now,
      updatedAt: now,
    });
  }

  async requestSessionCancellation(
    sessionId: string,
    now: Date
  ): Promise<QueueCancellationResult> {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const queued = tx
          .update(scrapeQueueItems)
          .set({
            status: "cancelled",
            cancelRequested: true,
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(scrapeQueueItems.sessionId, sessionId),
              eq(scrapeQueueItems.status, "queued")
            )
          )
          .returning({ id: scrapeQueueItems.id })
          .all();
        const running = tx
          .update(scrapeQueueItems)
          .set({ cancelRequested: true, updatedAt: now })
          .where(
            and(
              eq(scrapeQueueItems.sessionId, sessionId),
              eq(scrapeQueueItems.status, "running")
            )
          )
          .returning({ id: scrapeQueueItems.id })
          .all();
        const stoppedSession = tx
          .update(scrapeSessions)
          .set({ status: "failed", completedAt: now })
          .where(
            and(
              eq(scrapeSessions.id, sessionId),
              eq(scrapeSessions.status, "in_progress")
            )
          )
          .returning({ id: scrapeSessions.id })
          .get();
        return {
          cancelledQueued: queued.length,
          signalledRunning: running.length,
          sessionStopped: Boolean(stoppedSession),
        };
      }, { behavior: "immediate" })
    );
  }

  async recoverExpired(now: Date): Promise<QueueRecoveryResult> {
    return this.retryBusy(() =>
      this.database.transaction((tx) => {
        const cancelled = tx
          .update(scrapeQueueItems)
          .set({
            status: "cancelled",
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(scrapeQueueItems.status, "running"),
              lte(scrapeQueueItems.leaseExpiresAt, now),
              eq(scrapeQueueItems.cancelRequested, true)
            )
          )
          .returning({ id: scrapeQueueItems.id })
          .all();
        const failed = tx
          .update(scrapeQueueItems)
          .set({
            status: "failed",
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
            lastError: "Worker lease expired after the maximum number of attempts.",
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(scrapeQueueItems.status, "running"),
              lte(scrapeQueueItems.leaseExpiresAt, now),
              gte(scrapeQueueItems.attemptCount, scrapeQueueItems.maxAttempts)
            )
          )
          .returning({ id: scrapeQueueItems.id })
          .all();
        const requeued = tx
          .update(scrapeQueueItems)
          .set({
            status: "queued",
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
            availableAt: now,
            lastError: "Recovered after a worker lease expired.",
            updatedAt: now,
          })
          .where(
            and(
              eq(scrapeQueueItems.status, "running"),
              lte(scrapeQueueItems.leaseExpiresAt, now),
              lt(scrapeQueueItems.attemptCount, scrapeQueueItems.maxAttempts),
              eq(scrapeQueueItems.cancelRequested, false)
            )
          )
          .returning({ id: scrapeQueueItems.id })
          .all();
        return {
          requeued: requeued.length,
          failed: failed.length,
          cancelled: cancelled.length,
        };
      }, { behavior: "immediate" })
    );
  }

  async listSessionItems(sessionId: string) {
    return this.database
      .select()
      .from(scrapeQueueItems)
      .where(eq(scrapeQueueItems.sessionId, sessionId))
      .orderBy(asc(scrapeQueueItems.createdAt), asc(scrapeQueueItems.id));
  }

  async getNextAvailableAt(): Promise<Date | null> {
    const [queued, running] = await Promise.all([
      this.database
        .select({ availableAt: scrapeQueueItems.availableAt })
        .from(scrapeQueueItems)
        .where(eq(scrapeQueueItems.status, "queued"))
        .orderBy(asc(scrapeQueueItems.availableAt))
        .limit(1),
      this.database
        .select({ leaseExpiresAt: scrapeQueueItems.leaseExpiresAt })
        .from(scrapeQueueItems)
        .where(
          and(
            eq(scrapeQueueItems.status, "running"),
            isNotNull(scrapeQueueItems.leaseExpiresAt)
          )
        )
        .orderBy(asc(scrapeQueueItems.leaseExpiresAt))
        .limit(1),
    ]);
    const candidates = [queued[0]?.availableAt, running[0]?.leaseExpiresAt].filter(
      (value): value is Date => value instanceof Date
    );
    if (candidates.length === 0) return null;
    return new Date(Math.min(...candidates.map((value) => value.getTime())));
  }

  private async finishOwnedItem(
    itemId: string,
    workerId: string,
    values: Partial<typeof scrapeQueueItems.$inferInsert>,
    requireNotCancelled = false
  ): Promise<boolean> {
    const conditions = [
      eq(scrapeQueueItems.id, itemId),
      eq(scrapeQueueItems.workerId, workerId),
      eq(scrapeQueueItems.status, "running"),
    ];
    if (requireNotCancelled) {
      conditions.push(eq(scrapeQueueItems.cancelRequested, false));
    }
    const updated = await this.retryBusy(() =>
      this.database
        .update(scrapeQueueItems)
        .set(values)
        .where(and(...conditions))
        .returning({ id: scrapeQueueItems.id })
    );
    return updated.length === 1;
  }

}
