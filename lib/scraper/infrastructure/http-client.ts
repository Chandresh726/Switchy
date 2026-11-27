import type { ScrapeFetchStateStore } from "./fetch-state";
import { HttpError } from "./http-error";

export { HttpError } from "./http-error";
import { measureScrapeMetric, recordScrapeMetric } from "./metrics";
import { HostRequestPacer, type AdaptivePacingOptions } from "./host-request-pacer";

import {
  abortableDelay,
  createScrapeAbortError,
  getActiveScrapeSignal,
  runWithScrapeSignal,
} from "./cancellation";

export interface HttpClientConfig {
  timeout: number;
  retries: number;
  baseDelay: number;
  maxDelay: number;
  maxConcurrencyPerHost: number;
  jitterRatio: number;
  maxResponseBytes: number;
}

export interface HttpRequestOptions extends RequestInit {
  transport?: (url: string, options: RequestInit) => Promise<Response>;
  minIntervalMs?: number;
  adaptivePacing?: AdaptivePacingOptions;
  timeout?: number;
  retries?: number;
  baseDelay?: number;
  maxDelay?: number;
}

export interface IHttpClient {
  fetch(url: string, options?: HttpRequestOptions): Promise<Response>;
  get<T>(url: string, options?: HttpRequestOptions): Promise<T>;
  post<T>(url: string, body: unknown, options?: HttpRequestOptions): Promise<T>;
  runWithSignal?<T>(signal: AbortSignal, callback: () => Promise<T>): Promise<T>;
}

const DEFAULT_HTTP_CONFIG: HttpClientConfig = {
  timeout: 30000,
  retries: 3,
  baseDelay: 1000,
  maxDelay: 16000,
  maxConcurrencyPerHost: 6,
  jitterRatio: 0.2,
  maxResponseBytes: 64 * 1024 * 1024,
};

interface HostWaiter {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function isBlockedScrapeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::" ||
    normalized === "169.254.169.254" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".internal") ||
    normalized.startsWith("metadata.")
  ) {
    return true;
  }
  if (normalized.startsWith("127.")) return true;
  if (normalized.startsWith("10.") || normalized.startsWith("192.168.")) return true;
  const m172 = normalized.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  return false;
}

function parseScrapeHost(url: string): string {
  let hostname: string;
  let host: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
    host = parsed.host.toLowerCase();
  } catch {
    const err = new Error(`Invalid scrape URL: ${url}`);
    (err as Error & { url?: string }).url = url;
    throw err;
  }
  if (!hostname || isBlockedScrapeHostname(hostname)) {
    throw new Error(`Blocked scrape host: ${hostname || url}`);
  }
  return host;
}

export class FetchHttpClient implements IHttpClient {
  private readonly defaultConfig: HttpClientConfig;
  private readonly pacer = new HostRequestPacer();
  private readonly activeByHost = new Map<string, number>();
  private readonly waitersByHost = new Map<string, HostWaiter[]>();

  constructor(config: Partial<HttpClientConfig> = {}, private readonly state?: ScrapeFetchStateStore) {
    const merged = { ...DEFAULT_HTTP_CONFIG, ...config };
    this.defaultConfig = {
      ...merged,
      maxConcurrencyPerHost: Math.max(1, Math.floor(merged.maxConcurrencyPerHost)),
      jitterRatio: Math.max(0, Math.min(1, merged.jitterRatio)),
    };
  }

  runWithSignal<T>(signal: AbortSignal, callback: () => Promise<T>): Promise<T> {
    return runWithScrapeSignal(signal, callback);
  }

  async fetch(url: string, options: HttpRequestOptions = {}): Promise<Response> {
    const {
      timeout = this.defaultConfig.timeout,
      retries = this.defaultConfig.retries,
      baseDelay = this.defaultConfig.baseDelay,
      maxDelay = this.defaultConfig.maxDelay,
      signal: explicitSignal,
      transport,
      minIntervalMs = 0,
      adaptivePacing,
      ...fetchOptions
    } = options;
    const signal = explicitSignal ?? getActiveScrapeSignal();
    return await this.fetchWithRetry({
      url,
      options: fetchOptions,
      retries,
      baseDelay,
      maxDelay,
      timeout,
      signal,
      transport,
      minIntervalMs,
      adaptivePacing,
    });
  }

  async get<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
    const response = await this.fetch(url, { ...options, method: "GET" });
    if (!response.ok) {
      throw new HttpError(response.status, `HTTP ${response.status}: ${response.statusText}`, url, response.headers);
    }
    return response.json();
  }

  async post<T>(url: string, body: unknown, options: HttpRequestOptions = {}): Promise<T> {
    const response = await this.fetch(url, {
      ...options,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new HttpError(response.status, `HTTP ${response.status}: ${response.statusText}`, url, response.headers);
    }
    return response.json();
  }

  private checkCooldown(url: string): void {
    const entry = this.state?.get(`cooldown:${parseScrapeHost(url)}`) as { until?: number } | undefined;
    if (typeof entry?.until === "number" && entry.until > Date.now()) {
      recordScrapeMetric("cooldownBlocks");
      throw new HttpError(429, "Host rate limit cooldown is active", url,
        new Headers({ "retry-after": String(Math.ceil((entry.until - Date.now()) / 1000)) }));
    }
  }

  private static readonly MAX_REDIRECTS = 5;
  private static readonly REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

  private resolveRedirectTarget(currentUrl: string, location: string): string {
    let target: string;
    try {
      target = new URL(location, currentUrl).toString();
    } catch {
      throw new HttpError(400, `Invalid redirect target: ${location}`, currentUrl);
    }
    // Re-validate every hop: blocks loopback/metadata/private-network targets.
    // Note: hostname-string check only; DNS-rebinding (allowed name resolving
    // to private IP) is out of scope and documented as a limitation.
    parseScrapeHost(target);
    return target;
  }

  private async fetchWithRetry(args: {
    url: string;
    options: RequestInit;
    retries: number;
    baseDelay: number;
    maxDelay: number;
    timeout: number;
    signal?: AbortSignal;
    transport?: HttpRequestOptions["transport"];
    minIntervalMs: number;
    adaptivePacing?: AdaptivePacingOptions;
  }): Promise<Response> {
    let attempt = 0;
    let currentUrl = args.url;
    let currentOptions: RequestInit = { ...args.options };
    let redirectCount = 0;

    while (true) {
      this.throwIfAborted(args.signal);
      // Per-hop concurrency slot so cross-host redirects respect the target
      // host's limit instead of reusing the origin host's slot.
      this.checkCooldown(currentUrl);
      const release = await measureScrapeMetric("hostSlotWaitMs", () => this.acquireHostSlot(currentUrl, args.signal));
      let released = false;
      let requestStarted: number | undefined;
      const releaseAttempt = () => {
        if (!released) {
          released = true;
          if (requestStarted !== undefined) recordScrapeMetric("httpMs", performance.now() - requestStarted);
          release();
        }
      };
      const attemptController = new AbortController();
      const onAbort = () => attemptController.abort(args.signal?.reason);
      args.signal?.addEventListener("abort", onAbort, { once: true });
      const timeoutId = setTimeout(
        () => attemptController.abort(new DOMException("Request timed out", "AbortError")),
        args.timeout
      );

      try {
        const host = parseScrapeHost(currentUrl);
        await measureScrapeMetric("pacingWaitMs", () => this.pacer.wait(
          host, args.minIntervalMs, attemptController.signal, args.adaptivePacing
        ));
        this.checkCooldown(currentUrl);
        requestStarted = performance.now();
        recordScrapeMetric("httpRequests");
        const response = await (args.transport ?? fetch)(currentUrl, {
          redirect: "manual",
          ...currentOptions,
          signal: attemptController.signal,
        });

        if (
          FetchHttpClient.REDIRECT_STATUSES.has(response.status)
        ) {
          const location = response.headers.get("location");
          const status = response.status;
          await this.discardResponse(response);
          if (!location) {
            throw new HttpError(
              status,
              `Redirect without location from ${currentUrl}`,
              currentUrl
            );
          }
          if (redirectCount >= FetchHttpClient.MAX_REDIRECTS) {
            throw new HttpError(400, `Too many redirects from ${args.url}`, currentUrl);
          }
          redirectCount += 1;
          currentUrl = this.resolveRedirectTarget(currentUrl, location);
          // 301/302/303 convert to GET per fetch spec (strip body + content headers).
          // 307/308 preserve method + body.
          if (status === 303 || ((status === 301 || status === 302) && currentOptions.method !== "GET" && currentOptions.method !== "HEAD")) {
            const { ...rest } = currentOptions;
            const headers = new Headers(rest.headers);
            headers.delete("content-type");
            headers.delete("content-length");
            currentOptions = { ...rest, method: "GET", body: undefined, headers };
          }
          continue;
        }

        // A browser challenge is not a rate limit, regardless of its HTTP status.
        if (response.headers.get("cf-mitigated") === "challenge") {
          this.state?.delete(`cooldown:${host}`);
          await this.discardResponse(response);
          throw new HttpError(response.status, "Blocked by browser challenge", currentUrl, response.headers);
        }
        this.pacer.observe(host, response.status, args.minIntervalMs, args.adaptivePacing);
        if (response.status === 429) recordScrapeMetric("rateLimits");
        if (response.ok) recordScrapeMetric("httpSuccesses");
        if (response.ok && this.state) {
          const key = `cooldown:${host}`;
          const previous = this.state.get(key) as { strikes?: number } | undefined;
          if (previous?.strikes) {
            if (previous.strikes <= 1) this.state.delete(key);
            else this.state.set(key, { until: 0, strikes: previous.strikes - 1 },
              new Date(Date.now() + 24 * 60 * 60 * 1000));
          }
        }
        if (response.status === 429 && this.state) {
          const key = `cooldown:${parseScrapeHost(currentUrl)}`;
          const previous = this.state.get(key) as { strikes?: number } | undefined;
          const strikes = Math.min(5, (previous?.strikes ?? 0) + 1);
          const delay = Math.max(this.parseRetryAfter(response.headers.get("retry-after")) ?? 0,
            60_000 * 2 ** (strikes - 1) * (1 + Math.random() * this.defaultConfig.jitterRatio));
          const until = Date.now() + delay;
          this.state.set(key, { until, strikes }, new Date(until + 24 * 60 * 60 * 1000));
          const buffered = await this.bufferResponse(response, currentUrl);
          buffered.headers.set("retry-after", String(Math.ceil(delay / 1000)));
          return buffered;
        }
        // Long server-requested waits belong in the durable queue, not a worker.
        if ((this.parseRetryAfter(response.headers.get("retry-after")) ?? 0) > args.maxDelay) {
          return await this.bufferResponse(response, currentUrl);
        }

        if (!this.shouldRetryStatus(response.status) || attempt >= args.retries) {
          return await this.bufferResponse(response, currentUrl);
        }

        await this.discardResponse(response);
        const delayMs = this.resolveRetryDelay(
          response,
          args.baseDelay,
          args.maxDelay,
          attempt
        );
        clearTimeout(timeoutId);
        releaseAttempt();
        recordScrapeMetric("retries");
        await measureScrapeMetric("retryWaitMs", () => this.delay(delayMs, args.signal));
      } catch (error) {
        if (args.signal?.aborted) {
          this.throwIfAborted(args.signal);
        }
        if (error instanceof HttpError || attempt >= args.retries) throw error;

        const delayMs = this.applyJitter(
          Math.min(args.maxDelay, args.baseDelay * 2 ** attempt)
        );
        clearTimeout(timeoutId);
        releaseAttempt();
        recordScrapeMetric("retries");
        await measureScrapeMetric("retryWaitMs", () => this.delay(delayMs, args.signal));
      } finally {
        clearTimeout(timeoutId);
        args.signal?.removeEventListener("abort", onAbort);
        releaseAttempt();
      }

      attempt += 1;
    }
  }

  private shouldRetryStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  private resolveRetryDelay(
    response: Response,
    baseDelay: number,
    maxDelay: number,
    attempt: number
  ): number {
    const retryAfterMs = this.parseRetryAfter(response.headers.get("retry-after"));
    if (retryAfterMs !== null) {
      return retryAfterMs;
    }
    return this.applyJitter(Math.min(maxDelay, baseDelay * 2 ** attempt));
  }

  private parseRetryAfter(value: string | null): number | null {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - Date.now());
  }

  private applyJitter(delayMs: number): number {
    const ratio = this.defaultConfig.jitterRatio;
    if (ratio === 0) return delayMs;
    const factor = 1 - ratio + Math.random() * ratio * 2;
    return Math.max(0, Math.round(delayMs * factor));
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return abortableDelay(ms, signal);
  }

  private async acquireHostSlot(url: string, signal?: AbortSignal): Promise<() => void> {
    const host = parseScrapeHost(url);
    const active = this.activeByHost.get(host) ?? 0;
    const limit = host.endsWith(".myworkdayjobs.com") ? 1 : this.defaultConfig.maxConcurrencyPerHost;
    if (active < limit) {
      this.activeByHost.set(host, active + 1);
      return this.createRelease(host);
    }

    this.throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      const waiter: HostWaiter = { resolve, reject, signal };
      const onAbort = () => {
        const waiters = this.waitersByHost.get(host);
        const index = waiters?.indexOf(waiter) ?? -1;
        if (waiters && index >= 0) waiters.splice(index, 1);
        if (waiters?.length === 0) this.waitersByHost.delete(host);
        reject(this.abortReason(signal));
      };
      waiter.onAbort = onAbort;
      signal?.addEventListener("abort", onAbort, { once: true });
      const waiters = this.waitersByHost.get(host) ?? [];
      waiters.push(waiter);
      this.waitersByHost.set(host, waiters);
    });
  }

  private createRelease(host: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiters = this.waitersByHost.get(host);
      const next = waiters?.shift();
      if (next) {
        next.signal?.removeEventListener("abort", next.onAbort!);
        next.resolve(this.createRelease(host));
        if (waiters?.length === 0) this.waitersByHost.delete(host);
        return;
      }

      const active = (this.activeByHost.get(host) ?? 1) - 1;
      if (active <= 0) this.activeByHost.delete(host);
      else this.activeByHost.set(host, active);
    };
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw createScrapeAbortError(signal);
  }

  private async discardResponse(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // A consumed or synthetic response may not expose a cancellable body.
    }
  }

  private async bufferResponse(response: Response, requestUrl: string): Promise<Response> {
    const limit = this.defaultConfig.maxResponseBytes;
    const declared = Number(response.headers.get("content-length"));
    const oversized = () => new HttpError(413, `Scraper response exceeded ${limit} bytes`, requestUrl);
    if (declared > limit) {
      await this.discardResponse(response);
      throw oversized();
    }
    let body: ArrayBuffer;
    if (!response.body) {
      body = await response.arrayBuffer();
      if (body.byteLength > limit) throw oversized();
    } else {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > limit) throw oversized();
          chunks.push(chunk.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = bytes.buffer;
    }
    const buffered = new Response(body.byteLength > 0 ? body : null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(buffered, "url", {
      configurable: true,
      value: response.url || requestUrl,
    });
    return buffered;
  }

  private abortReason(signal?: AbortSignal): unknown {
    return createScrapeAbortError(signal);
  }
}

export function createHttpClient(config: Partial<HttpClientConfig> = {}, state?: ScrapeFetchStateStore): IHttpClient {
  return new FetchHttpClient(config, state);
}
