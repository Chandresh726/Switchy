import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { companies, scrapeQueueItems, scrapeSessions } from "@/lib/db/schema";
import { createSqliteBusyRetry } from "@/lib/db/sqlite-utils";
import { getCompanyScrapePlatform, SERIAL_SCRAPE_PLATFORMS } from "@/lib/scraper/services/execution-policy";
import { PLATFORMS } from "@/lib/scraper/types/platform";

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
            scheduledForAt: input.scheduledForAt,
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
        const candidate = this.findClaimable(tx, now);

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
            lastError: null,
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

  private findClaimable(database: Pick<typeof db, "select">, now: Date) {
    const running = database.select({
      id: companies.id, platform: companies.platform, careersUrl: companies.careersUrl,
    }).from(scrapeQueueItems).innerJoin(companies, eq(companies.id, scrapeQueueItems.companyId))
      .where(eq(scrapeQueueItems.status, "running")).all();
    const blocked = new Set(running.map((company) => company.id));
    const saturated = new Set(running.map(getCompanyScrapePlatform)
      .filter((platform) => platform !== "custom" && SERIAL_SCRAPE_PLATFORMS.includes(platform)));
    if (saturated.size > 0) {
      const candidates = database.select({ id: companies.id, platform: companies.platform, careersUrl: companies.careersUrl })
        .from(companies).where(or(
          inArray(companies.platform, [...saturated]), isNull(companies.platform), notInArray(companies.platform, [...PLATFORMS])
        )).all();
      for (const company of candidates) {
        if (saturated.has(getCompanyScrapePlatform(company))) blocked.add(company.id);
      }
    }
    return database
      .select()
      .from(scrapeQueueItems)
      .where(
        and(
          eq(scrapeQueueItems.status, "queued"),
          eq(scrapeQueueItems.cancelRequested, false),
          lte(scrapeQueueItems.availableAt, now),
          blocked.size ? notInArray(scrapeQueueItems.companyId, [...blocked]) : undefined
        )
      )
      .orderBy(
        asc(scrapeQueueItems.priority),
        asc(scrapeQueueItems.createdAt),
        asc(scrapeQueueItems.id)
      )
      .limit(1)
      .get();
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

  async defer(
    itemId: string, workerId: string, error: Error, availableAt: Date,
    now: Date, attemptCount: number
  ): Promise<boolean> {
    return this.deferSuspended(itemId, workerId, error, availableAt, now, attemptCount);
  }

  async deferSuspended(
    itemId: string,
    workerId: string,
    error: Error,
    availableAt: Date,
    now: Date,
    attemptCount: number
  ): Promise<boolean> {
    return this.finishOwnedItem(itemId, workerId, {
      status: "queued",
      workerId: null,
      lockedAt: null,
      leaseExpiresAt: null,
      attemptCount: Math.max(0, attemptCount),
      availableAt,
      lastError: error.message,
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
    const now = new Date();
    if (queued[0]?.availableAt && queued[0].availableAt <= now && !this.findClaimable(this.database, now)) {
      // Another dispatcher owns the resource. Poll at a bounded interval rather
      // than scheduling an immediate loop on an ineligible ready item.
      return new Date(now.getTime() + 1_000);
    }
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
