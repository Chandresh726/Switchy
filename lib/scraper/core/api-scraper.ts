import type {
  IScraper,
  ScraperCapabilities,
  ScraperConfig,
  ScrapeOptions,
  ScraperResult,
} from "./types";
import type { Platform } from "../types";
import { createScraperFailure } from "../types";
import {
  createFailureForHttpStatus,
  createFailureFromUnknown,
} from "../types/validation";
import type { IHttpClient, HttpRequestOptions } from "@/lib/scraper/infrastructure/http-client";
import { normalizeLocation, generateExternalId } from "../utils";

export abstract class AbstractApiScraper<
  TConfig extends ScraperConfig = ScraperConfig
> implements IScraper<TConfig> {
  abstract readonly platform: Platform;
  readonly requiresBrowser = false;
  readonly capabilities: ScraperCapabilities = {
    transport: "http",
    concurrency: "parallel",
    supportsCancellation: true,
  };

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

  protected async post<T>(
    url: string,
    body: unknown,
    options: HttpRequestOptions = {}
  ): Promise<T> {
    return this.httpClient.post<T>(url, body, {
      timeout: this.config.timeout,
      retries: this.config.retries,
      baseDelay: this.config.baseDelay,
      ...options,
    });
  }

  protected normalizeLocation = normalizeLocation;

  protected generateExternalId = generateExternalId;

  protected parseSourceUrl(url: string): URL | null {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  protected failure(
    code: Parameters<typeof createScraperFailure>[0],
    message: string,
    metadata: Parameters<typeof createScraperFailure>[2] = {}
  ): ReturnType<typeof createScraperFailure> {
    return createScraperFailure(code, message, metadata);
  }

  protected failureFromUnknown(error: unknown): ReturnType<typeof createScraperFailure> {
    return createFailureFromUnknown(error);
  }

  protected failureForHttpStatus(
    status: number,
    message: string
  ): ReturnType<typeof createScraperFailure> {
    return createFailureForHttpStatus(status, message);
  }
}
