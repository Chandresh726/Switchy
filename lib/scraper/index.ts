import type { IScraperRepository } from "./infrastructure/types";
import type { IHttpClient, HttpClientConfig } from "./infrastructure/http-client";
import type { IBrowserClient, BrowserSessionConfig } from "./infrastructure/browser-client";
import type { IScrapeOrchestrator, OrchestratorConfig } from "./services";

import { createHttpClient, createScraperRepository } from "./infrastructure";
import { createBrowserClient } from "./infrastructure";
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
  };
}

let defaultModule: ScrapingModule | null = null;

export function getScrapingModule(): ScrapingModule {
  if (!defaultModule) {
    defaultModule = createScrapingModule();
  }
  return defaultModule;
}

export function resetScrapingModule(): void {
  defaultModule = null;
}
