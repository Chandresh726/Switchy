import { getMatcherConfig } from "@/lib/ai/matcher";
import { dispatchPendingAIWork } from "@/lib/ai/work-items/dispatcher";
import type { db } from "@/lib/db";
import type { LocalLeasedWorkRunnerConfig } from "@/lib/runtime/leased-work-runner";
import { processSingleton } from "@/lib/runtime/process-singleton";

import { HistoryRetentionService } from "./application/history-retention-service";
import {
  createScrapeCompanyPipeline,
  DEFAULT_SCRAPE_COMPANY_PIPELINE_CONFIG,
  type ScrapeCompanyPipeline,
  type ScrapeCompanyPipelineConfig,
  type ScrapePipelineDependencies,
} from "./application/scrape-company-pipeline";
import { ScrapeSessionProjector } from "./application/scrape-session-projector";
import { ScrapeWorkHandler } from "./application/scrape-work-handler";
import {
  DrizzleStaleJobArchiveStore,
  StaleJobArchivalService,
  type StaleJobArchiveStore,
} from "./application/stale-job-archival-service";
import { DrizzleScrapeHistoryStore, type ScrapeHistoryRetentionStore } from "./history";
import { createBrowserClient, type IBrowserClient, type BrowserSessionConfig } from "./infrastructure/browser-client";
import type { ScrapeFetchStateStore } from "./infrastructure/fetch-state";
import { DrizzleScrapeFetchStateStore } from "./infrastructure/fetch-state-store";
import { createHttpClient, type IHttpClient, type HttpClientConfig } from "./infrastructure/http-client";
import { DrizzleScraperRepository } from "./infrastructure/repository";
import type { IScraperRepository } from "./infrastructure/types";
import { DrizzleScrapeSessionProjectionStore, type ScrapeSessionProjectionStore } from "./queue/projection-store";
import { DrizzleLocalScrapeQueueRepository } from "./queue/repository";
import { LocalScrapeQueueService, type LocalScrapeQueueServiceDependencies } from "./queue/service";
import type { ILocalScrapeQueueRepository } from "./queue/types";
import { createDeduplicationService, createFilterService, createScraperRegistry } from "./services";
import { StoredScrapeSettingsProvider, type ScrapeSettingsProvider } from "./settings/provider";

interface ScrapingModuleConfig {
  runtime?: Pick<LocalScrapeQueueServiceDependencies, "deviceSleepInhibitor" | "isDeviceAwake">;
  database?: typeof db;
  clients?: { http?: IHttpClient; browser?: IBrowserClient };
  stores?: {
    fetchState?: ScrapeFetchStateStore;
    queue?: ILocalScrapeQueueRepository;
    projection?: ScrapeSessionProjectionStore;
    history?: ScrapeHistoryRetentionStore;
    staleJobs?: StaleJobArchiveStore;
  };
  dependencies?: Partial<ScrapePipelineDependencies>;
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
  const repository = config.repository ?? new DrizzleScraperRepository(config.database);
  const settingsProvider =
    config.settingsProvider ?? new StoredScrapeSettingsProvider(repository);
  const fetchState = config.stores?.fetchState ?? new DrizzleScrapeFetchStateStore(config.database);
  const httpClient = config.clients?.http ?? createHttpClient(config.httpClient, fetchState);
  const browserClient = config.clients?.browser ?? createBrowserClient(config.browserClient);

  const registry = createScraperRegistry({ httpClient, browserClient, fetchState });
  const deduplicationService = createDeduplicationService();
  const filterService = createFilterService();

  const pipeline = createScrapeCompanyPipeline({
    repository,
    registry,
    deduplicationService,
    filterService,
    settingsProvider,
    dependencies: {
      fetchState,
      matchingEnabled: async () => (await getMatcherConfig()).autoMatchAfterScrape,
      dispatchMatching: dispatchPendingAIWork,
      ...config.dependencies,
    },
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

export function createLocalScrapeQueueService(
  config: ScrapingModuleConfig = {},
  runnerConfig: Partial<LocalLeasedWorkRunnerConfig> = {}
): LocalScrapeQueueService {
  const scrapingModule = createScrapingModule(config);
  const queueStore = config.stores?.queue ?? new DrizzleLocalScrapeQueueRepository(config.database);
  const projectionStore = config.stores?.projection ?? new DrizzleScrapeSessionProjectionStore(config.database);
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
    ...config.runtime,
    companyCatalog: scrapingModule.repository,
    sessionStore: scrapingModule.repository,
    queueStore,
    workHandler,
    projector,
    historyRetention: new HistoryRetentionService(
      config.stores?.history ?? new DrizzleScrapeHistoryStore(config.database),
      scrapingModule.settingsProvider,
      config.dependencies?.now
    ),
    staleJobArchival: new StaleJobArchivalService(
      config.stores?.staleJobs ?? new DrizzleStaleJobArchiveStore(config.database),
      scrapingModule.settingsProvider,
      config.dependencies?.now
    ),
    settingsProvider: scrapingModule.settingsProvider,
    runnerConfig: { concurrency: 10, ...runnerConfig },
  });
}

export function getLocalScrapeQueueService(): LocalScrapeQueueService {
  return processSingleton("localScrapeQueueService", () =>
    createLocalScrapeQueueService()
  );
}
