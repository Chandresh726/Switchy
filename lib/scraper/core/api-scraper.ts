import type { IScraper, ScraperConfig, ScrapeOptions, ScraperResult } from "./types";
import type { Platform } from "../types";
import type { IHttpClient, HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import { normalizeLocation, generateExternalId } from "../utils";

export abstract class AbstractApiScraper<
  TConfig extends ScraperConfig = ScraperConfig
> implements IScraper<TConfig> {
  abstract readonly platform: Platform;
  readonly requiresBrowser = false;

  constructor(
    protected readonly httpClient: IHttpClient,
    protected readonly config: TConfig
  ) {}

  abstract validate(url: string): boolean;
  abstract scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult>;
  abstract extractIdentifier(url: string): string | null;

  protected async fetch<T>(
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<T> {
    return this.httpClient.get<T>(url, {
      timeout: this.config.timeout,
      retries: this.config.retries,
      baseDelay: this.config.baseDelay,
      ...options,
    });
  }

  protected async fetchWithHeaders<T>(
    url: string,
    headers: Record<string, string>,
    options: HttpRequestOptions = {}
  ): Promise<T> {
    return this.httpClient.get<T>(url, {
      timeout: this.config.timeout,
      retries: this.config.retries,
      baseDelay: this.config.baseDelay,
      headers,
      ...options,
    });
  }

  protected normalizeLocation = normalizeLocation;

  protected generateExternalId = generateExternalId;
}
