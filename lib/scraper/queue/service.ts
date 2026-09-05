import type { ScrapeQueueItem } from "@/lib/db/schema";
import {
  recordDispatchSuccess,
  recordRuntimeError,
  setScrapeQueueRecovery,
} from "@/lib/runtime/health";
import { HistoryRetentionService } from "@/lib/scraper/application/history-retention-service";
import { StaleJobArchivalService } from "@/lib/scraper/application/stale-job-archival-service";
import { ScrapeSessionProjector } from "@/lib/scraper/application/scrape-session-projector";
import { ScrapeWorkHandler } from "@/lib/scraper/application/scrape-work-handler";
import type {
  CompanyCatalog,
  ScrapeSessionStore,
} from "@/lib/scraper/infrastructure/types";
import { serializeFetchResult } from "@/lib/scraper/queue/fetch-result-persistence";
import {
  LocalLeasedWorkRunner,
  type LocalLeasedWorkRunnerConfig,
} from "@/lib/scraper/runtime/leased-work-runner";
import { ScheduledSingleFlightDispatcher } from "@/lib/scraper/runtime/single-flight-dispatcher";
import {
  createDeviceSleepInhibitor,
  type DeviceSleepInhibitor,
  type DeviceSleepInhibitorLease,
} from "@/lib/scraper/runtime/device-sleep-inhibitor";
import type { ScrapeSettingsProvider } from "@/lib/scraper/settings/provider";
import type {
  BatchFetchResult,
  FetchResult,
  TriggerSource,
} from "@/lib/scraper/types";

import type {
  ILocalScrapeQueueRepository,
  QueueCancellationResult,
  QueueRecoveryResult,
  QueueRunSummary,
} from "./types";

const DISPATCH_FAILURE_RETRY_MS = 5_000;
const PLATFORM_QUEUE_PRIORITY: Record<string, number> = {
  eightfold: 10,
  workday: 20,
};
const DEFAULT_QUEUE_PRIORITY = 100;
const BROWSER_HEAVY_PLATFORMS = new Set(["eightfold", "workday"]);
const BROWSER_HEAVY_PRIORITY_BURST = 2;

export interface LocalScrapeQueueServiceDependencies {
  companyCatalog: CompanyCatalog;
  sessionStore: ScrapeSessionStore;
  queueStore: ILocalScrapeQueueRepository;
  workHandler: ScrapeWorkHandler;
  projector: ScrapeSessionProjector;
  historyRetention: HistoryRetentionService;
  staleJobArchival?: StaleJobArchivalService;
  settingsProvider: ScrapeSettingsProvider;
  deviceSleepInhibitor?: DeviceSleepInhibitor;
  runnerConfig?: Partial<LocalLeasedWorkRunnerConfig>;
}

export class LocalScrapeQueueService {
  private readonly queueStore: ILocalScrapeQueueRepository;
  private readonly projector: ScrapeSessionProjector;
  private readonly workHandler: ScrapeWorkHandler;
  private readonly historyRetention: HistoryRetentionService;
  private readonly staleJobArchival?: StaleJobArchivalService;
  private readonly deviceSleepInhibitor: DeviceSleepInhibitor;
  private readonly runner: LocalLeasedWorkRunner<
    ScrapeQueueItem,
    FetchResult,
    QueueRecoveryResult
  >;
  private readonly dispatcher: ScheduledSingleFlightDispatcher<QueueRunSummary>;
  private readonly inFlightBatches = new Map<string, Promise<BatchFetchResult>>();

  constructor(private readonly dependencies: LocalScrapeQueueServiceDependencies) {
    this.queueStore = dependencies.queueStore;
    this.projector = dependencies.projector;
    this.workHandler = dependencies.workHandler;
    this.historyRetention = dependencies.historyRetention;
    this.staleJobArchival = dependencies.staleJobArchival;
    this.deviceSleepInhibitor =
      dependencies.deviceSleepInhibitor ?? createDeviceSleepInhibitor();
    this.runner = new LocalLeasedWorkRunner(
      this.queueStore,
      (item, { signal }) => this.workHandler.handle(item, signal),
      { workerIdPrefix: "local-scrape", ...dependencies.runnerConfig },
      (item) => this.projector.reconcileSession(item.sessionId),
      serializeFetchResult
    );
    this.dispatcher = new ScheduledSingleFlightDispatcher({
      run: async () => {
        const summary = await this.runDispatch();
        recordDispatchSuccess();
        setScrapeQueueRecovery("ready");
        return summary;
      },
      getNextRunAt: (summary) => summary.nextAvailableAt,
      failureRetryMs: DISPATCH_FAILURE_RETRY_MS,
      onError: (error) => {
        setScrapeQueueRecovery("failed");
        recordRuntimeError("queue", "scrape_queue_dispatch_failed");
        console.error("[LocalScrapeQueueService] Queue dispatch failed:", error);
      },
    });
  }

  async scrapeAllCompanies(triggerSource: TriggerSource): Promise<BatchFetchResult> {
    const companies = await this.dependencies.companyCatalog.getActiveCompanies();
    const orderedCompanyIds = this.orderByStaticPriority(companies);
    return this.runCoalescedBatch(
      orderedCompanyIds,
      triggerSource
    );
  }

  async scrapeCompanies(
    companyIds: number[],
    triggerSource: TriggerSource
  ): Promise<BatchFetchResult> {
    const requestedIds = new Set(companyIds);
    const companies = await this.dependencies.companyCatalog.getActiveCompanies();
    const orderedCompanyIds = this.orderByStaticPriority(
      companies.filter((company) => requestedIds.has(company.id))
    );
    return this.runCoalescedBatch(
      orderedCompanyIds,
      triggerSource
    );
  }

  private orderByStaticPriority(
    companies: Awaited<ReturnType<CompanyCatalog["getActiveCompanies"]>>
  ): number[] {
    const byPriority = [...companies].sort((left, right) => {
      const leftPriority =
        PLATFORM_QUEUE_PRIORITY[left.platform ?? ""] ??
        DEFAULT_QUEUE_PRIORITY;
      const rightPriority =
        PLATFORM_QUEUE_PRIORITY[right.platform ?? ""] ??
        DEFAULT_QUEUE_PRIORITY;
      return leftPriority - rightPriority || left.id - right.id;
    });
    const browserHeavy = byPriority.filter((company) =>
      BROWSER_HEAVY_PLATFORMS.has(company.platform ?? "")
    );
    const standard = byPriority.filter(
      (company) => !BROWSER_HEAVY_PLATFORMS.has(company.platform ?? "")
    );
    const ordered: typeof byPriority = [];
    while (browserHeavy.length > 0 || standard.length > 0) {
      ordered.push(...browserHeavy.splice(0, BROWSER_HEAVY_PRIORITY_BURST));
      const nextStandard = standard.shift();
      if (nextStandard) ordered.push(nextStandard);
    }
    return ordered.map((company) => company.id);
  }

  private runCoalescedBatch(
    companyIds: number[],
    triggerSource: TriggerSource
  ): Promise<BatchFetchResult> {
    const uniqueCompanyIds = Array.from(new Set(companyIds));
    const key = [...uniqueCompanyIds].sort((a, b) => a - b).join(",");
    const existing = this.inFlightBatches.get(key);
    if (existing) return existing;

    const pending = this.enqueueAndWait(uniqueCompanyIds, triggerSource);
    this.inFlightBatches.set(key, pending);
    void pending.then(
      () => this.inFlightBatches.delete(key),
      () => this.inFlightBatches.delete(key)
    );
    return pending;
  }

  async recoverPending(): Promise<QueueRunSummary> {
    await this.workHandler.refreshParallelLimit();
    return this.requestDispatch();
  }

  async cancelSession(sessionId: string): Promise<QueueCancellationResult> {
    const cancellation = await this.queueStore.requestSessionCancellation(
      sessionId,
      new Date()
    );
    const result = cancellation.sessionStopped
      ? cancellation
      : {
          ...cancellation,
          sessionStopped:
            await this.dependencies.sessionStore.stopSession(sessionId),
        };
    await this.projector.reconcileSession(sessionId);
    return result;
  }

  private async enqueueAndWait(
    companyIds: number[],
    triggerSource: TriggerSource
  ): Promise<BatchFetchResult> {
    await this.workHandler.refreshParallelLimit();
    const sessionId = crypto.randomUUID();
    const uniqueCompanyIds = Array.from(new Set(companyIds));
    await this.queueStore.createSessionAndEnqueue({
      sessionId,
      triggerSource,
      companyIds: uniqueCompanyIds,
    });
    if (uniqueCompanyIds.length === 0) {
      await this.dependencies.sessionStore.completeSession(
        sessionId,
        "completed"
      );
      return this.projector.buildBatchResult(sessionId, []);
    }

    const waitController = new AbortController();
    const completion = this.projector.waitForTerminalItems(
      sessionId,
      waitController.signal
    );
    try {
      const [, items] = await Promise.all([
        this.requestDispatch(),
        completion,
      ]);
      return this.projector.buildBatchResult(sessionId, items);
    } catch (error) {
      waitController.abort(error);
      await completion.catch(() => undefined);
      throw error;
    }
  }

  private requestDispatch(): Promise<QueueRunSummary> {
    return this.dispatcher.request();
  }

  private async runDispatch(): Promise<QueueRunSummary> {
    let sleepInhibitorLease: DeviceSleepInhibitorLease | null = null;
    try {
      if (await this.dependencies.settingsProvider.getKeepDeviceAwake()) {
        sleepInhibitorLease = await this.deviceSleepInhibitor.acquire();
      }
    } catch (error) {
      console.warn(
        "[LocalScrapeQueueService] Failed to inhibit idle sleep:",
        error
      );
    }

    try {
      await this.projector.recoverCommittedQueueItems();
      const summary = await this.runner.runAvailable();
      await this.projector.reconcileInProgressSessions();
      await this.historyRetention.pruneIfDue();
      await this.staleJobArchival?.archiveIfDue();
      return summary;
    } finally {
      try {
        await sleepInhibitorLease?.release();
      } catch (error) {
        console.warn(
          "[LocalScrapeQueueService] Failed to release idle-sleep inhibitor:",
          error
        );
      }
    }
  }
}
