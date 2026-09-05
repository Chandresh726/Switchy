import type { IScraperRepository } from "./infrastructure/types";
import type { IHttpClient, HttpClientConfig } from "./infrastructure/http-client";
import type { IBrowserClient, BrowserSessionConfig } from "./infrastructure/browser-client";
import type { LocalLeasedWorkRunnerConfig } from "./runtime/leased-work-runner";
import type { ScrapeCompanyPipelineConfig } from "./application/scrape-company-pipeline";
import {
  StoredScrapeSettingsProvider,
  type ScrapeSettingsProvider,
} from "./settings/provider";

import {
  createScrapeCompanyPipeline,
  DEFAULT_SCRAPE_COMPANY_PIPELINE_CONFIG,
  type ScrapeCompanyPipeline,
} from "./application/scrape-company-pipeline";
import { HistoryRetentionService } from "./application/history-retention-service";
import { ScrapeSessionProjector } from "./application/scrape-session-projector";
import { ScrapeWorkHandler } from "./application/scrape-work-handler";
import { DrizzleScrapeHistoryStore } from "./history";
import { createHttpClient, createScraperRepository } from "./infrastructure";
import { createBrowserClient } from "./infrastructure";
import { DrizzleScrapeSessionProjectionStore } from "./queue/projection-store";
import { DrizzleLocalScrapeQueueRepository } from "./queue/repository";
import { LocalScrapeQueueService } from "./queue/service";
import {
  createDeduplicationService,
  createFilterService,
  createScraperRegistry,
} from "./services";

interface ScrapingModuleConfig {
  httpClient?: Partial<HttpClientConfig>;
  browserClient?: Partial<BrowserSessionConfig>;
  pipeline?: Partial<ScrapeCompanyPipelineConfig>;
  repository?: IScraperRepository;
  settingsProvider?: ScrapeSettingsProvider;
}

interface ScrapingModule {
  pipeline: ScrapeCompanyPipeline;
  repository: IScraperRepository;
  settingsProvider: ScrapeSettingsProvider;
  httpClient: IHttpClient;
  browserClient: IBrowserClient;
  registry: ReturnType<typeof createScraperRegistry>;
}

function createScrapingModule(config: ScrapingModuleConfig = {}): ScrapingModule {
  const repository = config.repository ?? createScraperRepository();
  const settingsProvider =
    config.settingsProvider ?? new StoredScrapeSettingsProvider(repository);
  const httpClient = createHttpClient(config.httpClient);
  const browserClient = createBrowserClient(config.browserClient);

  const registry = createScraperRegistry({ httpClient, browserClient });
  const deduplicationService = createDeduplicationService();
  const filterService = createFilterService();

  const pipeline = createScrapeCompanyPipeline({
    repository,
    registry,
    deduplicationService,
    filterService,
    settingsProvider,
    config: {
      ...DEFAULT_SCRAPE_COMPANY_PIPELINE_CONFIG,
      ...config.pipeline,
    },
  });

  return {
    pipeline,
    repository,
    settingsProvider,
    httpClient,
    browserClient,
    registry,
  };
}

let defaultQueueService: LocalScrapeQueueService | null = null;

function createLocalScrapeQueueService(
  config: ScrapingModuleConfig = {},
  runnerConfig: Partial<LocalLeasedWorkRunnerConfig> = {}
): LocalScrapeQueueService {
  const scrapingModule = createScrapingModule(config);
  const queueStore = new DrizzleLocalScrapeQueueRepository();
  const projectionStore = new DrizzleScrapeSessionProjectionStore();
  const projector = new ScrapeSessionProjector(
    queueStore,
    projectionStore,
    scrapingModule.repository,
    scrapingModule.repository
  );
  const workHandler = new ScrapeWorkHandler(
    scrapingModule.pipeline,
    scrapingModule.repository,
    queueStore,
    projectionStore,
    projector,
    scrapingModule.settingsProvider,
    scrapingModule.registry
  );
  return new LocalScrapeQueueService({
    companyCatalog: scrapingModule.repository,
    sessionStore: scrapingModule.repository,
    queueStore,
    workHandler,
    projector,
    historyRetention: new HistoryRetentionService(
      new DrizzleScrapeHistoryStore(),
      scrapingModule.settingsProvider
    ),
    settingsProvider: scrapingModule.settingsProvider,
    runnerConfig: { concurrency: 4, ...runnerConfig },
  });
}

export function getLocalScrapeQueueService(): LocalScrapeQueueService {
  if (!defaultQueueService) {
    defaultQueueService = createLocalScrapeQueueService();
  }
  return defaultQueueService;
}
