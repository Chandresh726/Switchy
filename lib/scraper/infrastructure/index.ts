export type {
  IScraperRepository,
  CompanyCatalog,
  ScrapeCompanyStore,
  ScrapeResultUnitOfWork,
  ScrapeSessionStore,
  ScrapeSettingsSource,
  ExistingJob,
  SessionProgressUpdate,
  ScrapingLogCreate,
  PersistScrapeResultInput,
  PersistScrapeResultOutput,
  ScrapeResultLogCreate,
} from "./types";

export { DrizzleScraperRepository, createScraperRepository } from "./repository";

export type {
  IHttpClient,
  HttpClientConfig,
  HttpRequestOptions,
} from "./http-client";

export {
  FetchHttpClient,
  HttpError,
  createHttpClient,
  DEFAULT_HTTP_CONFIG,
} from "./http-client";

export type {
  IBrowserClient,
  BrowserSession,
  BrowserSessionConfig,
} from "./browser-client";

export {
  PlaywrightBrowserClient,
  GenericBrowserClient,
  createBrowserClient,
  DEFAULT_BROWSER_CONFIG,
} from "./browser-client";
