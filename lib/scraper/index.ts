import type { IScraperRepository } from "./infrastructure/types";
import type { IHttpClient, HttpClientConfig } from "./infrastructure/http-client";
import type { IBrowserClient, BrowserSessionConfig } from "./infrastructure/browser-client";
import type { IScrapeOrchestrator, OrchestratorConfig } from "./services";

import { createHttpClient, createScraperRepository } from "./infrastructure";
import { createBrowserClient } from "./infrastructure";
import {
  DrizzleLocalScrapeQueueRepository,
  LocalScrapeQueueService,
  type LocalScrapeQueueRunnerConfig,
} from "./queue";
import { createScraperRegistry, createDeduplicationService, createFilterService, createScrapeOrchestrator, DEFAULT_ORCHESTRATOR_CONFIG } from "./services";

export interface ScrapingModuleConfig {
  httpClient?: Partial<HttpClientConfig>;
  browserClient?: Partial<BrowserSessionConfig>;
  orchestrator?: Partial<OrchestratorConfig>;
  repository?: IScraperRepository;
}

export interface ScrapingModule {
  orchestrator: IScrapeOrchestrator;
  repository: IScraperRepository;
  httpClient: IHttpClient;
  browserClient: IBrowserClient;
  registry: ReturnType<typeof createScraperRegistry>;
}

export function createScrapingModule(config: ScrapingModuleConfig = {}): ScrapingModule {
  const repository = config.repository ?? createScraperRepository();
  const httpClient = createHttpClient(config.httpClient);
  const browserClient = createBrowserClient(config.browserClient);

  const registry = createScraperRegistry({ httpClient, browserClient });
  const deduplicationService = createDeduplicationService();
  const filterService = createFilterService();

  const orchestrator = createScrapeOrchestrator({
    repository,
    registry,
    deduplicationService,
    filterService,
    config: { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config.orchestrator },
  });

  return {
    orchestrator,
    repository,
    httpClient,
    browserClient,
    registry,
  };
}

let defaultModule: ScrapingModule | null = null;
let defaultQueueService: LocalScrapeQueueService | null = null;

export function getScrapingModule(): ScrapingModule {
  if (!defaultModule) {
    defaultModule = createScrapingModule();
  }
  return defaultModule;
}

export function resetScrapingModule(): void {
  defaultModule = null;
  defaultQueueService = null;
}

export function createLocalScrapeQueueService(
  scrapingModule: ScrapingModule = createScrapingModule(),
  runnerConfig: Partial<LocalScrapeQueueRunnerConfig> = {}
): LocalScrapeQueueService {
  return new LocalScrapeQueueService({
    orchestrator: scrapingModule.orchestrator,
    scraperRepository: scrapingModule.repository,
    registry: scrapingModule.registry,
    queueRepository: new DrizzleLocalScrapeQueueRepository(),
    runnerConfig: { concurrency: 10, ...runnerConfig },
  });
}

export function getLocalScrapeQueueService(): LocalScrapeQueueService {
  if (!defaultQueueService) {
    defaultQueueService = createLocalScrapeQueueService(getScrapingModule());
  }
  return defaultQueueService;
}

export {
  DrizzleLocalScrapeQueueRepository,
  LocalScrapeQueueRunner,
  LocalScrapeQueueService,
} from "./queue";
export {
  deleteScrapeHistory,
  pruneScrapeHistory,
  type DeleteScrapeHistoryResult,
  type PruneScrapeHistoryResult,
} from "./history";
export type {
  ILocalScrapeQueueRepository,
  LocalScrapeQueueRunnerConfig,
  QueueCancellationResult,
  QueueRunSummary,
} from "./queue";
