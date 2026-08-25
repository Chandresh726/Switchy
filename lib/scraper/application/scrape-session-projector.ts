import type { ScrapeQueueItem } from "@/lib/db/schema";
import type {
  CompanyCatalog,
  ScrapeSessionStore,
} from "@/lib/scraper/infrastructure/types";
import type { ILocalScrapeQueueRepository } from "@/lib/scraper/queue/types";
import type { ScrapeSessionProjectionStore } from "@/lib/scraper/queue/projection-store";
import {
  createFetchResultFromCommittedScrape,
  parseFetchResult,
} from "@/lib/scraper/queue/fetch-result-persistence";
import {
  isPlatform,
  type BatchFetchResult,
  type FetchResult,
} from "@/lib/scraper/types";

const TERMINAL_QUEUE_STATUSES = ["completed", "failed", "cancelled"] as const;
const DURABLE_SESSION_RECHECK_INTERVAL_MS = 1_000;

interface SessionChangeSubscription {
  promise: Promise<void>;
  cancel: () => void;
}

export class ScrapeSessionProjector {
  private readonly sessionChangeWaiters = new Map<
    string,
    Set<() => void>
  >();

  constructor(
    private readonly queueStore: Pick<
      ILocalScrapeQueueRepository,
      "listSessionItems"
    >,
    private readonly projectionStore: ScrapeSessionProjectionStore,
    private readonly sessionStore: ScrapeSessionStore,
    private readonly companyCatalog: Pick<CompanyCatalog, "getCompany">
  ) {}

  async reconcileInProgressSessions(): Promise<void> {
    const sessionIds = await this.projectionStore.listInProgressSessionIds();
    await Promise.all(sessionIds.map((sessionId) => this.reconcileSession(sessionId)));
  }

  async reconcileSession(sessionId: string): Promise<void> {
    try {
      const items = await this.queueStore.listSessionItems(sessionId);
      if (items.length === 0) {
        const session = await this.projectionStore.getSession(sessionId);
        if (session?.status === "in_progress") {
          await this.sessionStore.completeSession(
            sessionId,
            (session.companiesCompleted ?? 0) > 0 ? "partial" : "failed"
          );
        }
        return;
      }
      const terminalItems = items.filter((item) => this.isTerminal(item.status));
      const results = await Promise.all(
        terminalItems.map((item) => this.toFetchResult(item))
      );
      const progress = this.calculateProgress(results);
      await this.sessionStore.updateSessionProgress(sessionId, {
        companiesCompleted: terminalItems.length,
        ...progress,
      });
      if (terminalItems.length === items.length) {
        await this.sessionStore.completeSession(
          sessionId,
          this.resolveSessionStatus(results)
        );
      }
    } finally {
      this.notifySessionChanged(sessionId);
    }
  }

  async recoverCommittedQueueItems(): Promise<number> {
    return this.projectionStore.recoverCommittedQueueItems();
  }

  async loadCommittedResult(
    sessionId: string,
    companyId: number
  ): Promise<FetchResult | null> {
    const committed = await this.projectionStore.getCommittedResult(
      sessionId,
      companyId
    );
    return committed ? createFetchResultFromCommittedScrape(committed) : null;
  }

  async waitForTerminalItems(
    sessionId: string,
    signal: AbortSignal
  ): Promise<ScrapeQueueItem[]> {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const change = this.subscribeToSessionChange(sessionId, signal);
      try {
        const items = await this.queueStore.listSessionItems(sessionId);
        if (items.length === 0) {
          throw new Error(`Scrape queue work for session ${sessionId} was removed.`);
        }
        if (items.every((item) => this.isTerminal(item.status))) return items;
        await change.promise;
      } finally {
        change.cancel();
      }
    }
  }

  async buildBatchResult(
    sessionId: string,
    items: ScrapeQueueItem[]
  ): Promise<BatchFetchResult> {
    const results = await Promise.all(items.map((item) => this.toFetchResult(item)));
    const session = await this.projectionStore.getSession(sessionId);
    const successfulCompanies = results.filter(
      (result) => result.outcome === "success" && !result.skipped
    ).length;
    const skippedCompanies = results.filter((result) => result.skipped).length;
    const failedCompanies = results.filter(
      (result) => result.outcome !== "success"
    ).length;
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

  private async toFetchResult(item: ScrapeQueueItem): Promise<FetchResult> {
    if (item.status === "completed" && item.resultJson) {
      const parsed = parseFetchResult(item.resultJson, item.companyId);
      if (parsed) return parsed;
    }

    const company = await this.companyCatalog.getCompany(item.companyId);
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
      platform:
        company?.platform && isPlatform(company.platform)
          ? company.platform
          : null,
      error:
        item.lastError ??
        (item.status === "cancelled"
          ? "Scrape was cancelled"
          : "Queue result was unavailable"),
      duration: Math.max(
        0,
        (item.completedAt?.getTime() ?? Date.now()) -
          (item.startedAt?.getTime() ?? item.createdAt.getTime())
      ),
    };
  }

  private calculateProgress(results: FetchResult[]) {
    return {
      totalJobsFound: results.reduce((sum, result) => sum + result.jobsFound, 0),
      totalJobsAdded: results.reduce((sum, result) => sum + result.jobsAdded, 0),
      totalJobsFiltered: results.reduce(
        (sum, result) => sum + result.jobsFiltered,
        0
      ),
      totalJobsArchived: results.reduce(
        (sum, result) => sum + result.jobsArchived,
        0
      ),
    };
  }

  private resolveSessionStatus(
    results: FetchResult[]
  ): "completed" | "partial" | "failed" {
    if (
      results.length === 0 ||
      results.every((result) => result.outcome === "success")
    ) {
      return "completed";
    }
    if (results.every((result) => result.outcome === "error")) return "failed";
    return "partial";
  }

  private isTerminal(status: string): boolean {
    return TERMINAL_QUEUE_STATUSES.includes(
      status as (typeof TERMINAL_QUEUE_STATUSES)[number]
    );
  }

  private subscribeToSessionChange(
    sessionId: string,
    signal: AbortSignal
  ): SessionChangeSubscription {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    let recheckTimer: ReturnType<typeof setTimeout> | null = null;
    const promise = new Promise<void>((complete, fail) => {
      resolve = complete;
      reject = fail;
    });
    let settled = false;
    const cleanup = () => {
      const current = this.sessionChangeWaiters.get(sessionId);
      current?.delete(notify);
      if (current?.size === 0) this.sessionChangeWaiters.delete(sessionId);
      signal.removeEventListener("abort", onAbort);
      if (recheckTimer) clearTimeout(recheckTimer);
    };
    const notify = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(signal.reason);
    };
    const waiters = this.sessionChangeWaiters.get(sessionId) ?? new Set();
    waiters.add(notify);
    this.sessionChangeWaiters.set(sessionId, waiters);
    signal.addEventListener("abort", onAbort, { once: true });
    recheckTimer = setTimeout(notify, DURABLE_SESSION_RECHECK_INTERVAL_MS);
    return {
      promise,
      cancel: cleanup,
    };
  }

  private notifySessionChanged(sessionId: string): void {
    const waiters = this.sessionChangeWaiters.get(sessionId);
    if (!waiters) return;
    this.sessionChangeWaiters.delete(sessionId);
    for (const resolve of waiters) resolve();
  }
}
