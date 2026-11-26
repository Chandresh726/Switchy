import type { ScrapeQueueItem } from "@/lib/db/schema";
import type { CompanyCatalog } from "@/lib/scraper/infrastructure/types";
import { getCompanyScrapePlatform } from "@/lib/scraper/services/execution-policy";
import { createScrapeMetrics, recordScrapeMetric, withScrapeMetrics } from "@/lib/scraper/infrastructure/metrics";
import type { ScrapeSessionProjectionStore } from "@/lib/scraper/queue/projection-store";
import type { ILocalScrapeQueueRepository } from "@/lib/scraper/queue/types";
import {
  getLocalDataOperationGate,
  type LocalDataOperationGate,
} from "@/lib/runtime/data-operation-gate";
import { KeyedExecutionLock } from "@/lib/runtime/keyed-lock";
import {
  ScrapeResourceExecutionGate,
  type ScrapeResourceClass,
} from "@/lib/scraper/runtime/resource-execution-gate";
import { SCRAPER_SETTINGS } from "@/lib/scraper/settings/definitions";
import type { ScrapeSettingsProvider } from "@/lib/scraper/settings/provider";
import type { IScraperRegistry } from "@/lib/scraper/services";
import {
  isTriggerSource,
  type FetchResult,
} from "@/lib/scraper/types";

import type { ScrapeCompanyPipeline } from "./scrape-company-pipeline";
import type { ScrapeSessionProjector } from "./scrape-session-projector";

class RetryableScrapeError extends Error {
  constructor(message: string, readonly retryAfterMs?: number, readonly retryable = true) {
    super(message);
    this.name = "RetryableScrapeError";
  }
}

export class ScrapeWorkHandler {
  private readonly executionGate = new ScrapeResourceExecutionGate(
    SCRAPER_SETTINGS.maxParallelScrapes.defaultValue
  );
  private readonly companyLocks = new KeyedExecutionLock<number>();

  constructor(
    private readonly pipeline: Pick<ScrapeCompanyPipeline, "scrape">,
    private readonly companyCatalog: Pick<CompanyCatalog, "getCompany">,
    private readonly queueStore: Pick<
      ILocalScrapeQueueRepository,
      "requestSessionCancellation"
    >,
    private readonly projectionStore: ScrapeSessionProjectionStore,
    private readonly projector: ScrapeSessionProjector,
    private readonly settingsProvider: ScrapeSettingsProvider,
    private readonly registry?: IScraperRegistry,
    private readonly dataOperationGate: LocalDataOperationGate =
      getLocalDataOperationGate()
  ) {}

  async refreshParallelLimit(): Promise<void> {
    this.executionGate.setTotalLimit(
      await this.settingsProvider.getMaxParallelScrapes()
    );
  }

  async handle(
    item: ScrapeQueueItem,
    signal: AbortSignal
  ): Promise<FetchResult> {
    const metrics = createScrapeMetrics(Date.now() - item.availableAt.getTime());
    return withScrapeMetrics(metrics, async () => {
      const started = performance.now();
      let outcome: string = "error";
      try {
        const result = await this.dataOperationGate.runScrape(item.companyId, signal, (workSignal) =>
          this.handleWithDataFence(item, workSignal, started)
        );
        outcome = result.outcome;
        return { ...result, metrics };
      } finally {
        console.info(JSON.stringify({ event: "scrape_timing", sessionId: item.sessionId, companyId: item.companyId,
          attempt: item.attemptCount, outcome: signal.aborted ? "cancelled" : outcome, ...metrics }));
      }
    });
  }

  private async handleWithDataFence(
    item: ScrapeQueueItem,
    signal: AbortSignal,
    admissionStarted: number
  ): Promise<FetchResult> {
    const session = await this.projectionStore.getSession(item.sessionId);
    if (
      !session ||
      session.status !== "in_progress" ||
      !isTriggerSource(session.triggerSource)
    ) {
      await this.queueStore.requestSessionCancellation(item.sessionId, new Date());
      throw new Error(`Scrape session ${item.sessionId} is no longer active.`);
    }

    const committedResult = await this.projector.loadCommittedResult(
      item.sessionId,
      item.companyId
    );
    if (committedResult) return committedResult;

    // Same-company work is serialized by this lock, so once it is held any
    // overlapping session's scrape has already committed its log.
    const releaseCompany = await this.companyLocks.acquire(item.companyId, signal);
    let releaseExecution: (() => void) | null = null;
    try {
      const concurrentResult = await this.projector.loadConcurrentResult(
        item.sessionId,
        item.companyId,
        item.createdAt
      );
      if (concurrentResult) return concurrentResult;

      const executionMode = await this.resolveExecutionMode(item.companyId);
      releaseExecution = await this.executionGate.acquire(executionMode, signal);
      recordScrapeMetric("executionWaitMs", performance.now() - admissionStarted);
      const result = await this.pipeline.scrape(item.companyId, {
        sessionId: item.sessionId,
        triggerSource: session.triggerSource,
        signal,
        attemptCount: item.attemptCount,
        maxAttempts: item.maxAttempts,
      });
      if (result.outcome === "error") {
        throw new RetryableScrapeError(
          result.error ?? `Retryable scrape failure for company ${item.companyId}`,
          result.retryAfterMs,
          result.retryable ?? false
        );
      }
      return result;
    } finally {
      releaseExecution?.();
      releaseCompany();
    }
  }

  private async resolveExecutionMode(
    companyId: number
  ): Promise<ScrapeResourceClass> {
    if (!this.registry) return "standard";
    const company = await this.companyCatalog.getCompany(companyId);
    if (!company) return "standard";
    const detected = getCompanyScrapePlatform(company);
    if (detected === "custom") return "standard";
    const scraper = this.registry.getScraperByPlatform(detected);
    return scraper?.capabilities.concurrency === "browser_limited"
      ? "browser_heavy"
      : "standard";
  }
}
