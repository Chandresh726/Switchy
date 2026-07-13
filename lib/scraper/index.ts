import type { IScraperRepository } from "./infrastructure/types";
import type { IHttpClient, HttpClientConfig } from "./infrastructure/http-client";
import type { IBrowserClient, BrowserSessionConfig } from "./infrastructure/browser-client";
import type { IScrapeOrchestrator, OrchestratorConfig } from "./services";
import type { LocalLeasedWorkRunnerConfig } from "./runtime/leased-work-runner";
import {
  StoredScrapeSettingsProvider,
  type ScrapeSettingsProvider,
} from "./settings/provider";

import { createHttpClient, createScraperRepository } from "./infrastructure";
import { createBrowserClient } from "./infrastructure";
import {
  DrizzleLocalScrapeQueueRepository,
  LocalScrapeQueueService,
} from "./queue";
import { createScraperRegistry, createDeduplicationService, createFilterService, createScrapeOrchestrator, DEFAULT_ORCHESTRATOR_CONFIG } from "./services";

export interface ScrapingModuleConfig {
  httpClient?: Partial<HttpClientConfig>;
  browserClient?: Partial<BrowserSessionConfig>;
  orchestrator?: Partial<OrchestratorConfig>;
  repository?: IScraperRepository;
  settingsProvider?: ScrapeSettingsProvider;
}

export interface ScrapingModule {
  orchestrator: IScrapeOrchestrator;
  repository: IScraperRepository;
  settingsProvider: ScrapeSettingsProvider;
  httpClient: IHttpClient;
  browserClient: IBrowserClient;
  registry: ReturnType<typeof createScraperRegistry>;
}

export function createScrapingModule(config: ScrapingModuleConfig = {}): ScrapingModule {
  const repository = config.repository ?? createScraperRepository();
  const settingsProvider =
    config.settingsProvider ?? new StoredScrapeSettingsProvider(repository);
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
    settingsProvider,
    config: { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config.orchestrator },
  });

  return {
    orchestrator,
    repository,
    settingsProvider,
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
  runnerConfig: Partial<LocalLeasedWorkRunnerConfig> = {}
): LocalScrapeQueueService {
  return new LocalScrapeQueueService({
    orchestrator: scrapingModule.orchestrator,
    scraperRepository: scrapingModule.repository,
    settingsProvider: scrapingModule.settingsProvider,
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
  QueueCancellationResult,
  QueueRunSummary,
} from "./queue";
