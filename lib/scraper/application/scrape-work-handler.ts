import type { ScrapeQueueItem } from "@/lib/db/schema";
import type { CompanyCatalog } from "@/lib/scraper/infrastructure/types";
import { detectPlatformFromUrl } from "@/lib/scraper/platform-detection";
import type { ScrapeSessionProjectionStore } from "@/lib/scraper/queue/projection-store";
import type { ILocalScrapeQueueRepository } from "@/lib/scraper/queue/types";
import {
  getLocalDataOperationGate,
  type LocalDataOperationGate,
} from "@/lib/scraper/runtime/data-operation-gate";
import { KeyedExecutionLock } from "@/lib/scraper/runtime/keyed-lock";
import {
  ScrapeResourceExecutionGate,
  type ScrapeResourceClass,
} from "@/lib/scraper/runtime/resource-execution-gate";
import { SCRAPER_SETTINGS } from "@/lib/scraper/settings/definitions";
import type { ScrapeSettingsProvider } from "@/lib/scraper/settings/provider";
import type { IScraperRegistry } from "@/lib/scraper/services";
import {
  isPlatform,
  isTriggerSource,
  type FetchResult,
} from "@/lib/scraper/types";

import type { ScrapeCompanyPipeline } from "./scrape-company-pipeline";
import type { ScrapeSessionProjector } from "./scrape-session-projector";

class RetryableScrapeError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
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
    return this.dataOperationGate.runScrape(item.companyId, signal, (workSignal) =>
      this.handleWithDataFence(item, workSignal)
    );
  }

  private async handleWithDataFence(
    item: ScrapeQueueItem,
    signal: AbortSignal
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

    const releaseCompany = await this.companyLocks.acquire(item.companyId, signal);
    let releaseExecution: (() => void) | null = null;
    try {
      const executionMode = await this.resolveExecutionMode(item.companyId);
      releaseExecution = await this.executionGate.acquire(executionMode, signal);
      const result = await this.pipeline.scrape(item.companyId, {
        sessionId: item.sessionId,
        triggerSource: session.triggerSource,
        signal,
        attemptCount: item.attemptCount,
        maxAttempts: item.maxAttempts,
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
  }

  private async resolveExecutionMode(
    companyId: number
  ): Promise<ScrapeResourceClass> {
    if (!this.registry) return "standard";
    const company = await this.companyCatalog.getCompany(companyId);
    if (!company) return "standard";
    const detected =
      company.platform && isPlatform(company.platform)
        ? company.platform
        : detectPlatformFromUrl(company.careersUrl);
    if (detected === "custom") return "standard";
    const scraper = this.registry.getScraperByPlatform(detected);
    return scraper?.capabilities.concurrency === "browser_limited"
      ? "browser_heavy"
      : "standard";
  }
}
