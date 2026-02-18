import type { IScraper, ScraperConfig, ScrapeOptions, ScraperResult } from "./types";
import type { Platform } from "../types";
import type { IHttpClient, HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import type { IBrowserClient, BrowserSession } from "@/lib/scraper/infrastructure/browser-client";
import { normalizeLocation, generateExternalId } from "../utils";

export abstract class AbstractBrowserScraper<
  TConfig extends ScraperConfig = ScraperConfig
> implements IScraper<TConfig> {
  abstract readonly platform: Platform;
  readonly requiresBrowser = true;

  constructor(
    protected readonly httpClient: IHttpClient,
    protected readonly browserClient: IBrowserClient,
    protected readonly config: TConfig
  ) {}

  abstract validate(url: string): boolean;
  abstract scrape(url: string, options?: ScrapeOptions): Promise<ScraperResult>;
  abstract extractIdentifier(url: string): string | null;
  protected abstract bootstrapSession(url: string): Promise<BrowserSession | null>;

  protected async fetch<T>(
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

  protected async post<T>(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    options: HttpRequestOptions = {}
  ): Promise<T> {
    return this.httpClient.post<T>(url, body, {
      timeout: this.config.timeout,
      retries: this.config.retries,
      baseDelay: this.config.baseDelay,
      headers,
      ...options,
    });
  }

  protected normalizeLocation = normalizeLocation;

  protected generateExternalId = generateExternalId;

  protected async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
