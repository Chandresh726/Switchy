import { and, asc, eq, gte, lt, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { scrapeQueueItems } from "@/lib/db/schema";

import type {
  EnqueueScrapeWork,
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

  constructor(
    private readonly database: typeof db = db,
    config: Partial<DrizzleLocalScrapeQueueRepositoryConfig> = {}
  ) {
    const merged = { ...DEFAULT_REPOSITORY_CONFIG, ...config };
    this.config = {
      claimBusyRetries: Math.max(0, Math.floor(merged.claimBusyRetries)),
      claimBusyRetryDelayMs: Math.max(0, merged.claimBusyRetryDelayMs),
    };
  }

  async enqueue(input: EnqueueScrapeWork) {
    if (input.companyIds.length === 0) return [];
    const now = new Date();
    return this.database
      .insert(scrapeQueueItems)
      .values(
        input.companyIds.map((companyId) => ({
          id: crypto.randomUUID(),
          sessionId: input.sessionId,
          companyId,
          status: "queued",
          priority: input.priority ?? 100,
          maxAttempts: input.maxAttempts ?? 3,
          availableAt: input.availableAt ?? now,
          createdAt: now,
          updatedAt: now,
        }))
      )
      .onConflictDoNothing({
        target: [scrapeQueueItems.sessionId, scrapeQueueItems.companyId],
      })
      .returning();
  }

  async claimNext(workerId: string, now: Date, leaseDurationMs: number) {
    return this.withBusyRetry(() =>
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
          .orderBy(asc(scrapeQueueItems.priority), asc(scrapeQueueItems.createdAt))
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
    const updated = await this.database
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
      .returning({ id: scrapeQueueItems.id });
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
      lastError: null,
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
    return this.database.transaction((tx) => {
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
      return {
        cancelledQueued: queued.length,
        signalledRunning: running.length,
      };
    });
  }

  async recoverExpired(now: Date): Promise<QueueRecoveryResult> {
    return this.database.transaction((tx) => {
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
    });
  }

  async listSessionItems(sessionId: string) {
    return this.database
      .select()
      .from(scrapeQueueItems)
      .where(eq(scrapeQueueItems.sessionId, sessionId))
      .orderBy(asc(scrapeQueueItems.createdAt));
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
    const updated = await this.database
      .update(scrapeQueueItems)
      .set(values)
      .where(
        and(...conditions)
      )
      .returning({ id: scrapeQueueItems.id });
    return updated.length === 1;
  }

  private async withBusyRetry<T>(operation: () => T): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return operation();
      } catch (error) {
        if (!this.isSqliteBusy(error) || attempt >= this.config.claimBusyRetries) {
          throw error;
        }
        const delayMs = this.config.claimBusyRetryDelayMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private isSqliteBusy(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
      const candidate = current as { code?: unknown; cause?: unknown };
      if (candidate.code === "SQLITE_BUSY" || candidate.code === "SQLITE_BUSY_SNAPSHOT") {
        return true;
      }
      current = candidate.cause;
    }
    return false;
  }
}
