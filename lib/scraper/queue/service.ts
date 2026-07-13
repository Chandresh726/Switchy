import type { ScrapeQueueItem } from "@/lib/db/schema";
import { HistoryRetentionService } from "@/lib/scraper/application/history-retention-service";
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

export interface LocalScrapeQueueServiceDependencies {
  companyCatalog: CompanyCatalog;
  sessionStore: ScrapeSessionStore;
  queueStore: ILocalScrapeQueueRepository;
  workHandler: ScrapeWorkHandler;
  projector: ScrapeSessionProjector;
  historyRetention: HistoryRetentionService;
  runnerConfig?: Partial<LocalLeasedWorkRunnerConfig>;
}

export class LocalScrapeQueueService {
  private readonly queueStore: ILocalScrapeQueueRepository;
  private readonly projector: ScrapeSessionProjector;
  private readonly workHandler: ScrapeWorkHandler;
  private readonly historyRetention: HistoryRetentionService;
  private readonly runner: LocalLeasedWorkRunner<
    ScrapeQueueItem,
    FetchResult,
    QueueRecoveryResult
  >;
  private readonly dispatcher: ScheduledSingleFlightDispatcher<QueueRunSummary>;

  constructor(private readonly dependencies: LocalScrapeQueueServiceDependencies) {
    this.queueStore = dependencies.queueStore;
    this.projector = dependencies.projector;
    this.workHandler = dependencies.workHandler;
    this.historyRetention = dependencies.historyRetention;
    this.runner = new LocalLeasedWorkRunner(
      this.queueStore,
      (item, { signal }) => this.workHandler.handle(item, signal),
      { workerIdPrefix: "local-scrape", ...dependencies.runnerConfig },
      (item) => this.projector.reconcileSession(item.sessionId),
      serializeFetchResult
    );
    this.dispatcher = new ScheduledSingleFlightDispatcher({
      run: () => this.runDispatch(),
      getNextRunAt: (summary) => summary.nextAvailableAt,
      failureRetryMs: DISPATCH_FAILURE_RETRY_MS,
      onError: (error) => {
        console.error("[LocalScrapeQueueService] Queue dispatch failed:", error);
      },
    });
  }

  async scrapeAllCompanies(triggerSource: TriggerSource): Promise<BatchFetchResult> {
    const companies = await this.dependencies.companyCatalog.getActiveCompanies();
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
    const companies = await this.dependencies.companyCatalog.getActiveCompanies();
    return this.enqueueAndWait(
      companies
        .filter((company) => requestedIds.has(company.id))
        .map((company) => company.id),
      triggerSource
    );
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
    await this.projector.recoverCommittedQueueItems();
    const summary = await this.runner.runAvailable();
    await this.projector.reconcileInProgressSessions();
    await this.historyRetention.pruneIfDue();
    return summary;
  }
}
