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
}

export interface HttpRequestOptions extends RequestInit {
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
  retries: 2,
  baseDelay: 1000,
  maxDelay: 16000,
  maxConcurrencyPerHost: 3,
  jitterRatio: 0.2,
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
  private readonly activeByHost = new Map<string, number>();
  private readonly waitersByHost = new Map<string, HostWaiter[]>();

  constructor(config: Partial<HttpClientConfig> = {}) {
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
    });
  }

  async get<T>(url: string, options: HttpRequestOptions = {}): Promise<T> {
    const response = await this.fetch(url, { ...options, method: "GET" });
    if (!response.ok) {
      throw new HttpError(response.status, `HTTP ${response.status}: ${response.statusText}`, url);
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
      throw new HttpError(response.status, `HTTP ${response.status}: ${response.statusText}`, url);
    }
    return response.json();
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
  }): Promise<Response> {
    let attempt = 0;
    let currentUrl = args.url;
    let currentOptions: RequestInit = { ...args.options };
    let redirectCount = 0;

    while (true) {
      this.throwIfAborted(args.signal);
      // Per-hop concurrency slot so cross-host redirects respect the target
      // host's limit instead of reusing the origin host's slot.
      const release = await this.acquireHostSlot(currentUrl, args.signal);
      const attemptController = new AbortController();
      const onAbort = () => attemptController.abort(args.signal?.reason);
      args.signal?.addEventListener("abort", onAbort, { once: true });
      const timeoutId = setTimeout(
        () => attemptController.abort(new DOMException("Request timed out", "AbortError")),
        args.timeout
      );

      try {
        const response = await fetch(currentUrl, {
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
        await this.delay(delayMs, args.signal);
      } catch (error) {
        if (args.signal?.aborted) {
          this.throwIfAborted(args.signal);
        }
        if (error instanceof HttpError && error.status === 413) throw error;
        if (attempt >= args.retries) throw error;

        const delayMs = this.applyJitter(
          Math.min(args.maxDelay, args.baseDelay * 2 ** attempt)
        );
        await this.delay(delayMs, args.signal);
      } finally {
        clearTimeout(timeoutId);
        args.signal?.removeEventListener("abort", onAbort);
        release();
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
      return Math.min(maxDelay, retryAfterMs);
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
    if (active < this.defaultConfig.maxConcurrencyPerHost) {
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

  private static readonly MAX_BODY_BYTES = 10 * 1024 * 1024;

  private async bufferResponse(response: Response, requestUrl: string): Promise<Response> {
    const body = await response.arrayBuffer();
    if (body.byteLength > FetchHttpClient.MAX_BODY_BYTES) {
      throw new HttpError(413, `Response body exceeds 10MB limit from ${requestUrl}`, requestUrl);
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

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly url: string
  ) {
    super(message);
    this.name = "HttpError";
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}

export function createHttpClient(config: Partial<HttpClientConfig> = {}): IHttpClient {
  return new FetchHttpClient(config);
}
