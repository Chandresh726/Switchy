import { and, asc, eq, inArray, or } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  companies,
  scrapeQueueItems,
  scrapeSessions,
  scrapingLogs,
} from "@/lib/db/schema";
import type { IScraperRepository } from "@/lib/scraper/infrastructure/types";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";
import type { IScrapeOrchestrator, IScraperRegistry } from "@/lib/scraper/services";
import {
  isPlatform,
  isTriggerSource,
  type BatchFetchResult,
  type FetchResult,
  type TriggerSource,
} from "@/lib/scraper/types";

import { DrizzleLocalScrapeQueueRepository } from "./repository";
import {
  LocalScrapeQueueRunner,
  type LocalScrapeQueueRunnerConfig,
} from "./runner";
import type {
  ILocalScrapeQueueRepository,
  QueueCancellationResult,
  QueueRunSummary,
} from "./types";

const TERMINAL_QUEUE_STATUSES = ["completed", "failed", "cancelled"] as const;
const MAX_PARALLEL_SCRAPES_SETTING = "scraper_max_parallel_scrapes";
const DEFAULT_MAX_PARALLEL_SCRAPES = 3;
const MAX_PARALLEL_SCRAPES = 10;
const DISPATCH_FAILURE_RETRY_MS = 5_000;

type ExecutionMode = "shared" | "exclusive";

class RetryableScrapeError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "RetryableScrapeError";
  }
}

interface ExecutionWaiter {
  mode: ExecutionMode;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

class ScrapeExecutionGate {
  private readonly waiters: ExecutionWaiter[] = [];
  private activeShared = 0;
  private activeExclusive = false;
  private sharedLimit = DEFAULT_MAX_PARALLEL_SCRAPES;

  setSharedLimit(limit: number): void {
    this.sharedLimit = Math.min(MAX_PARALLEL_SCRAPES, Math.max(1, Math.floor(limit)));
    this.drain();
  }

  acquire(mode: ExecutionMode, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const waiter: ExecutionWaiter = {
        mode,
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(signal.reason);
          this.drain();
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    if (this.activeExclusive || this.waiters.length === 0) return;
    const first = this.waiters[0];
    if (first?.mode === "exclusive") {
      if (this.activeShared > 0) return;
      this.grant(this.waiters.shift()!);
      return;
    }
    while (
      this.waiters[0]?.mode === "shared" &&
      this.activeShared < this.sharedLimit &&
      !this.activeExclusive
    ) {
      this.grant(this.waiters.shift()!);
    }
  }

  private grant(waiter: ExecutionWaiter): void {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    if (waiter.mode === "exclusive") this.activeExclusive = true;
    else this.activeShared += 1;
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      if (waiter.mode === "exclusive") this.activeExclusive = false;
      else this.activeShared = Math.max(0, this.activeShared - 1);
      this.drain();
    });
  }
}

interface CompanyLockWaiter {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

class CompanyExecutionLocks {
  private readonly activeCompanies = new Set<number>();
  private readonly waiters = new Map<number, CompanyLockWaiter[]>();

  acquire(companyId: number, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const waiter: CompanyLockWaiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const companyWaiters = this.waiters.get(companyId);
          const index = companyWaiters?.indexOf(waiter) ?? -1;
          if (companyWaiters && index >= 0) companyWaiters.splice(index, 1);
          if (companyWaiters?.length === 0) this.waiters.delete(companyId);
          reject(signal.reason);
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      if (this.activeCompanies.has(companyId)) {
        const companyWaiters = this.waiters.get(companyId) ?? [];
        companyWaiters.push(waiter);
        this.waiters.set(companyId, companyWaiters);
        return;
      }
      this.activeCompanies.add(companyId);
      this.grant(companyId, waiter);
    });
  }

  private grant(companyId: number, waiter: CompanyLockWaiter): void {
    waiter.signal.removeEventListener("abort", waiter.onAbort);
    let released = false;
    waiter.resolve(() => {
      if (released) return;
      released = true;
      const companyWaiters = this.waiters.get(companyId);
      const next = companyWaiters?.shift();
      if (companyWaiters?.length === 0) this.waiters.delete(companyId);
      if (next) this.grant(companyId, next);
      else this.activeCompanies.delete(companyId);
    });
  }
}

export interface LocalScrapeQueueServiceDependencies {
  orchestrator: IScrapeOrchestrator;
  scraperRepository: IScraperRepository;
  registry?: IScraperRegistry;
  queueRepository?: ILocalScrapeQueueRepository;
  database?: typeof db;
  runnerConfig?: Partial<LocalScrapeQueueRunnerConfig>;
}

export class LocalScrapeQueueService {
  private readonly database: typeof db;
  private readonly queueRepository: ILocalScrapeQueueRepository;
  private readonly runner: LocalScrapeQueueRunner<FetchResult>;
  private readonly executionGate = new ScrapeExecutionGate();
  private readonly companyLocks = new CompanyExecutionLocks();
  private activeDispatch: Promise<QueueRunSummary> | null = null;
  private dispatchRequested = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly dependencies: LocalScrapeQueueServiceDependencies) {
    this.database = dependencies.database ?? db;
    this.queueRepository =
      dependencies.queueRepository ?? new DrizzleLocalScrapeQueueRepository(this.database);
    this.runner = new LocalScrapeQueueRunner(
      this.queueRepository,
      async (item, { signal }) => {
        const session = this.database
          .select({ triggerSource: scrapeSessions.triggerSource, status: scrapeSessions.status })
          .from(scrapeSessions)
          .where(eq(scrapeSessions.id, item.sessionId))
          .limit(1)
          .get();
        if (
          !session ||
          session.status !== "in_progress" ||
          !isTriggerSource(session.triggerSource)
        ) {
          await this.queueRepository.requestSessionCancellation(item.sessionId, new Date());
          throw new Error(`Scrape session ${item.sessionId} is no longer active.`);
        }
        const committedResult = await this.loadCommittedResult(
          item.sessionId,
          item.companyId
        );
        if (committedResult) return committedResult;
        const releaseCompany = await this.companyLocks.acquire(item.companyId, signal);
        let releaseExecution: (() => void) | null = null;
        try {
          const executionMode = await this.resolveExecutionMode(item.companyId);
          releaseExecution = await this.executionGate.acquire(executionMode, signal);
          const result = await dependencies.orchestrator.scrapeCompany(item.companyId, {
            sessionId: item.sessionId,
            triggerSource: session.triggerSource,
            signal,
          });
          if (result.outcome === "error" && result.retryable) {
            throw new RetryableScrapeError(
              result.error ?? `Retryable scrape failure for company ${item.companyId}`,
              result.retryAfterMs
            );
          }
          return result;
        } finally {
          releaseExecution?.();
          releaseCompany();
        }
      },
      dependencies.runnerConfig,
      async (item) => {
        await this.reconcileSession(item.sessionId);
      }
    );
  }

  async scrapeAllCompanies(triggerSource: TriggerSource): Promise<BatchFetchResult> {
    const companies = await this.dependencies.scraperRepository.getActiveCompanies();
    return this.enqueueAndWait(
      companies.map((company) => company.id),
      triggerSource
    );
  }

  async scrapeCompanies(
    companyIds: number[],
    triggerSource: TriggerSource
  ): Promise<BatchFetchResult> {
    const requestedIds = new Set(companyIds);
    const companies = await this.dependencies.scraperRepository.getActiveCompanies();
    return this.enqueueAndWait(
      companies
        .filter((company) => requestedIds.has(company.id))
        .map((company) => company.id),
      triggerSource
    );
  }

  async recoverPending(): Promise<QueueRunSummary> {
    this.executionGate.setSharedLimit(await this.loadParallelLimit());
    return this.requestDispatch();
  }

  async cancelSession(sessionId: string): Promise<QueueCancellationResult> {
    const cancellation = await this.queueRepository.requestSessionCancellation(
      sessionId,
      new Date()
    );
    if (cancellation.sessionStopped) return cancellation;
    return {
      ...cancellation,
      sessionStopped: await this.dependencies.scraperRepository.stopSession(sessionId),
    };
  }

  async listSessionItems(sessionId: string) {
    return this.queueRepository.listSessionItems(sessionId);
  }

  private async enqueueAndWait(
    companyIds: number[],
    triggerSource: TriggerSource
  ): Promise<BatchFetchResult> {
    this.executionGate.setSharedLimit(await this.loadParallelLimit());
    const sessionId = crypto.randomUUID();
    await this.queueRepository.createSessionAndEnqueue({
      sessionId,
      triggerSource,
      companyIds: Array.from(new Set(companyIds)),
    });
    if (companyIds.length === 0) {
      return this.buildBatchResult(sessionId, []);
    }

    while (true) {
      await this.requestDispatch();
      await this.reconcileSession(sessionId);
      const items = await this.queueRepository.listSessionItems(sessionId);
      if (items.length === 0) {
        throw new Error(`Scrape queue work for session ${sessionId} was removed.`);
      }
      if (items.every((item) => this.isTerminalStatus(item.status))) {
        return this.buildBatchResult(sessionId, items);
      }

      const nextAt = this.getSessionNextActionAt(items);
      const delayMs = Math.min(
        1_000,
        Math.max(25, (nextAt?.getTime() ?? Date.now() + 100) - Date.now())
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  private requestDispatch(): Promise<QueueRunSummary> {
    if (this.activeDispatch) {
      this.dispatchRequested = true;
      return this.activeDispatch;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    const dispatch = this.runDispatch();
    this.activeDispatch = dispatch;
    let dispatchFailed = false;
    void dispatch
      .catch((error) => {
        dispatchFailed = true;
        console.error("[LocalScrapeQueueService] Queue dispatch failed:", error);
      })
      .finally(() => {
        if (this.activeDispatch === dispatch) this.activeDispatch = null;
        if (this.dispatchRequested) {
          this.dispatchRequested = false;
          void this.requestDispatch();
        } else if (dispatchFailed) {
          this.scheduleNextDispatch(
            new Date(Date.now() + DISPATCH_FAILURE_RETRY_MS)
          );
        }
      });
    return dispatch;
  }

  private async runDispatch(): Promise<QueueRunSummary> {
    await this.recoverCommittedQueueItems();
    const summary = await this.runner.runAvailable();
    await this.reconcileInProgressSessions();
    this.scheduleNextDispatch(summary.nextAvailableAt);
    return summary;
  }

  private scheduleNextDispatch(nextAvailableAt: Date | null): void {
    if (!nextAvailableAt) return;
    const delayMs = Math.max(0, nextAvailableAt.getTime() - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.requestDispatch();
    }, delayMs);
    if (typeof this.retryTimer === "object" && "unref" in this.retryTimer) {
      this.retryTimer.unref();
    }
  }

  private async reconcileInProgressSessions(): Promise<void> {
    const sessions = await this.database
      .selectDistinct({ id: scrapeSessions.id })
      .from(scrapeSessions)
      .innerJoin(scrapeQueueItems, eq(scrapeQueueItems.sessionId, scrapeSessions.id))
      .where(eq(scrapeSessions.status, "in_progress"));
    await Promise.all(sessions.map((session) => this.reconcileSession(session.id)));
  }

  private async reconcileSession(sessionId: string): Promise<void> {
    const items = await this.queueRepository.listSessionItems(sessionId);
    if (items.length === 0) return;
    const terminalItems = items.filter((item) => this.isTerminalStatus(item.status));
    const results = await Promise.all(terminalItems.map((item) => this.toFetchResult(item)));
    const progress = this.calculateProgress(results);
    await this.dependencies.scraperRepository.updateSessionProgress(sessionId, {
      companiesCompleted: terminalItems.length,
      ...progress,
    });
    if (terminalItems.length === items.length) {
      await this.dependencies.scraperRepository.completeSession(
        sessionId,
        this.resolveSessionStatus(results)
      );
    }
  }

  private async buildBatchResult(
    sessionId: string,
    items: Awaited<ReturnType<ILocalScrapeQueueRepository["listSessionItems"]>>
  ): Promise<BatchFetchResult> {
    const results = await Promise.all(items.map((item) => this.toFetchResult(item)));
    const session = this.database
      .select({ startedAt: scrapeSessions.startedAt })
      .from(scrapeSessions)
      .where(eq(scrapeSessions.id, sessionId))
      .limit(1)
      .get();
    const successfulCompanies = results.filter(
      (result) => result.outcome === "success" && !result.skipped
    ).length;
    const skippedCompanies = results.filter((result) => result.skipped).length;
    const failedCompanies = results.filter((result) => result.outcome !== "success").length;
    const progress = this.calculateProgress(results);

    return {
      sessionId,
      results,
      summary: {
        totalCompanies: items.length,
        successfulCompanies,
        skippedCompanies,
        failedCompanies,
        ...progress,
        totalDuration: Math.max(
          0,
          Date.now() - (session?.startedAt?.getTime() ?? Date.now())
        ),
      },
    };
  }

  private async toFetchResult(
    item: Awaited<ReturnType<ILocalScrapeQueueRepository["listSessionItems"]>>[number]
  ): Promise<FetchResult> {
    if (item.status === "completed" && item.resultJson) {
      try {
        const parsed: unknown = JSON.parse(item.resultJson);
        if (this.isFetchResult(parsed, item.companyId)) return parsed;
      } catch {
        // Fall through to a durable queue error result.
      }
    }

    const company = await this.dependencies.scraperRepository.getCompany(item.companyId);
    return {
      companyId: item.companyId,
      companyName: company?.name ?? "Unknown",
      success: false,
      outcome: "error",
      jobsFound: 0,
      jobsAdded: 0,
      jobsUpdated: 0,
      jobsFiltered: 0,
      jobsArchived: 0,
      platform: company?.platform && isPlatform(company.platform) ? company.platform : null,
      error:
        item.lastError ??
        (item.status === "cancelled" ? "Scrape was cancelled" : "Queue result was unavailable"),
      duration: Math.max(
        0,
        (item.completedAt?.getTime() ?? Date.now()) -
          (item.startedAt?.getTime() ?? item.createdAt.getTime())
      ),
    };
  }

  private async loadCommittedResult(
    sessionId: string,
    companyId: number
  ): Promise<FetchResult | null> {
    const committed = await this.database
      .select({
        id: scrapingLogs.id,
        status: scrapingLogs.status,
        jobsFound: scrapingLogs.jobsFound,
        jobsAdded: scrapingLogs.jobsAdded,
        jobsUpdated: scrapingLogs.jobsUpdated,
        jobsFiltered: scrapingLogs.jobsFiltered,
        jobsArchived: scrapingLogs.jobsArchived,
        platform: scrapingLogs.platform,
        duration: scrapingLogs.duration,
      })
      .from(scrapingLogs)
      .where(
        and(
          eq(scrapingLogs.sessionId, sessionId),
          eq(scrapingLogs.companyId, companyId),
          or(eq(scrapingLogs.status, "success"), eq(scrapingLogs.status, "partial"))
        )
      )
      .orderBy(asc(scrapingLogs.id))
      .limit(1)
      .get();
    if (!committed) return null;
    const company = await this.dependencies.scraperRepository.getCompany(companyId);
    const outcome = committed.status === "success" ? "success" : "partial";
    return {
      companyId,
      companyName: company?.name ?? "Unknown",
      success: outcome === "success",
      outcome,
      jobsFound: committed.jobsFound ?? 0,
      jobsAdded: committed.jobsAdded ?? 0,
      jobsUpdated: committed.jobsUpdated ?? 0,
      jobsFiltered: committed.jobsFiltered ?? 0,
      jobsArchived: committed.jobsArchived ?? 0,
      platform:
        committed.platform && isPlatform(committed.platform)
          ? committed.platform
          : null,
      duration: committed.duration ?? 0,
      logId: committed.id,
    };
  }

  private async recoverCommittedQueueItems(): Promise<void> {
    this.database.transaction((tx) => {
      const committedRows = tx
        .select({
          itemId: scrapeQueueItems.id,
          companyId: scrapeQueueItems.companyId,
          companyName: companies.name,
          logId: scrapingLogs.id,
          status: scrapingLogs.status,
          jobsFound: scrapingLogs.jobsFound,
          jobsAdded: scrapingLogs.jobsAdded,
          jobsUpdated: scrapingLogs.jobsUpdated,
          jobsFiltered: scrapingLogs.jobsFiltered,
          jobsArchived: scrapingLogs.jobsArchived,
          platform: scrapingLogs.platform,
          duration: scrapingLogs.duration,
        })
        .from(scrapeQueueItems)
        .innerJoin(scrapeSessions, eq(scrapeSessions.id, scrapeQueueItems.sessionId))
        .innerJoin(
          scrapingLogs,
          and(
            eq(scrapingLogs.sessionId, scrapeQueueItems.sessionId),
            eq(scrapingLogs.companyId, scrapeQueueItems.companyId)
          )
        )
        .leftJoin(companies, eq(companies.id, scrapeQueueItems.companyId))
        .where(
          and(
            inArray(scrapeQueueItems.status, ["queued", "running"]),
            eq(scrapeQueueItems.cancelRequested, false),
            eq(scrapeSessions.status, "in_progress"),
            or(eq(scrapingLogs.status, "success"), eq(scrapingLogs.status, "partial"))
          )
        )
        .orderBy(asc(scrapingLogs.id))
        .all();
      const earliestByItem = new Map<
        string,
        (typeof committedRows)[number]
      >();
      for (const row of committedRows) {
        if (!earliestByItem.has(row.itemId)) earliestByItem.set(row.itemId, row);
      }

      const completedAt = new Date();
      for (const row of earliestByItem.values()) {
        const outcome = row.status === "success" ? "success" : "partial";
        const result: FetchResult = {
          companyId: row.companyId,
          companyName: row.companyName ?? "Unknown",
          success: outcome === "success",
          outcome,
          jobsFound: row.jobsFound ?? 0,
          jobsAdded: row.jobsAdded ?? 0,
          jobsUpdated: row.jobsUpdated ?? 0,
          jobsFiltered: row.jobsFiltered ?? 0,
          jobsArchived: row.jobsArchived ?? 0,
          platform: row.platform && isPlatform(row.platform) ? row.platform : null,
          duration: row.duration ?? 0,
          logId: row.logId,
        };
        tx.update(scrapeQueueItems)
          .set({
            status: "completed",
            resultJson: JSON.stringify(result),
            workerId: null,
            lockedAt: null,
            leaseExpiresAt: null,
            completedAt,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(scrapeQueueItems.id, row.itemId),
              inArray(scrapeQueueItems.status, ["queued", "running"]),
              eq(scrapeQueueItems.cancelRequested, false)
            )
          )
          .run();
      }
    }, { behavior: "immediate" });
  }

  private isFetchResult(value: unknown, companyId: number): value is FetchResult {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<FetchResult>;
    return (
      candidate.companyId === companyId &&
      typeof candidate.companyName === "string" &&
      typeof candidate.success === "boolean" &&
      ["success", "partial", "error"].includes(candidate.outcome ?? "") &&
      typeof candidate.jobsFound === "number" &&
      typeof candidate.jobsAdded === "number" &&
      typeof candidate.jobsUpdated === "number" &&
      typeof candidate.jobsFiltered === "number" &&
      typeof candidate.jobsArchived === "number" &&
      (candidate.retryable === undefined || typeof candidate.retryable === "boolean") &&
      (candidate.retryAfterMs === undefined || typeof candidate.retryAfterMs === "number") &&
      typeof candidate.duration === "number"
    );
  }

  private calculateProgress(results: FetchResult[]) {
    return {
      totalJobsFound: results.reduce((sum, result) => sum + result.jobsFound, 0),
      totalJobsAdded: results.reduce((sum, result) => sum + result.jobsAdded, 0),
      totalJobsFiltered: results.reduce((sum, result) => sum + result.jobsFiltered, 0),
      totalJobsArchived: results.reduce((sum, result) => sum + result.jobsArchived, 0),
    };
  }

  private resolveSessionStatus(
    results: FetchResult[]
  ): "completed" | "partial" | "failed" {
    if (results.length === 0 || results.every((result) => result.outcome === "success")) {
      return "completed";
    }
    if (results.every((result) => result.outcome === "error")) return "failed";
    return "partial";
  }

  private isTerminalStatus(status: string): boolean {
    return TERMINAL_QUEUE_STATUSES.includes(
      status as (typeof TERMINAL_QUEUE_STATUSES)[number]
    );
  }

  private getSessionNextActionAt(
    items: Awaited<ReturnType<ILocalScrapeQueueRepository["listSessionItems"]>>
  ): Date | null {
    const candidates = items.flatMap((item) => {
      if (item.status === "queued") return [item.availableAt];
      if (item.status === "running" && item.leaseExpiresAt) return [item.leaseExpiresAt];
      return [];
    });
    if (candidates.length === 0) return null;
    return new Date(Math.min(...candidates.map((value) => value.getTime())));
  }

  private async resolveExecutionMode(companyId: number): Promise<ExecutionMode> {
    if (!this.dependencies.registry) return "shared";
    const company = await this.dependencies.scraperRepository.getCompany(companyId);
    if (!company) return "shared";
    const detected =
      company.platform && isPlatform(company.platform)
        ? company.platform
        : detectPlatformFromUrl(company.careersUrl);
    if (detected === "custom") return "shared";
    const scraper = this.dependencies.registry.getScraperByPlatform(detected);
    return scraper?.capabilities.concurrency === "serial" ? "exclusive" : "shared";
  }

  private async loadParallelLimit(): Promise<number> {
    const value = await this.dependencies.scraperRepository.getSetting(
      MAX_PARALLEL_SCRAPES_SETTING
    );
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed)) return DEFAULT_MAX_PARALLEL_SCRAPES;
    return Math.min(MAX_PARALLEL_SCRAPES, Math.max(1, parsed));
  }
}
