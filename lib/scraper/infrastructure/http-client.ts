export interface HttpClientConfig {
  timeout: number;
  retries: number;
  baseDelay: number;
  maxDelay: number;
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
}

export const DEFAULT_HTTP_CONFIG: HttpClientConfig = {
  timeout: 30000,
  retries: 3,
  baseDelay: 1000,
  maxDelay: 16000,
};

export class FetchHttpClient implements IHttpClient {
  private readonly defaultConfig: HttpClientConfig;

  constructor(config: Partial<HttpClientConfig> = {}) {
    this.defaultConfig = { ...DEFAULT_HTTP_CONFIG, ...config };
  }

  async fetch(url: string, options: HttpRequestOptions = {}): Promise<Response> {
    const {
      timeout = this.defaultConfig.timeout,
      retries = this.defaultConfig.retries,
      baseDelay = this.defaultConfig.baseDelay,
      maxDelay = this.defaultConfig.maxDelay,
      ...fetchOptions
    } = options;

    return this.fetchWithRetry(url, fetchOptions, retries, baseDelay, maxDelay, timeout);
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

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries: number,
    baseDelay: number,
    maxDelay: number,
    timeout: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      if (response.ok) return response;

      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return response;
      }

      if (retries <= 0) return response;

      await this.delay(baseDelay);
      return this.fetchWithRetry(
        url,
        options,
        retries - 1,
        Math.min(maxDelay, baseDelay * 2),
        maxDelay,
        timeout
      );
    } catch (error) {
      if (retries <= 0) throw error;

      await this.delay(baseDelay);
      return this.fetchWithRetry(
        url,
        options,
        retries - 1,
        Math.min(maxDelay, baseDelay * 2),
        maxDelay,
        timeout
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
