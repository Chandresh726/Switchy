import { chromium } from "playwright";
import type { Browser, BrowserContext, Page, Request } from "playwright";

import {
  createScrapeAbortError,
  getActiveScrapeSignal,
  runWithScrapeSignal,
  throwIfScrapeAborted,
} from "./cancellation";

export interface BrowserSessionConfig {
  headless: boolean;
  timeout: number;
  userAgent: string;
  viewport: { width: number; height: number };
}

export interface BrowserSession {
  baseUrl: string;
  cookies: string;
  csrfToken?: string;
  domain?: string;
  tenant?: string;
  board?: string;
}

export interface IBrowserClient {
  bootstrap(url: string): Promise<BrowserSession | null>;
  withBrowser<T>(callback: (page: Page) => Promise<T>): Promise<T>;
  runWithSignal?<T>(signal: AbortSignal, callback: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const DEFAULT_BROWSER_CONFIG: BrowserSessionConfig = {
  headless: true,
  timeout: 30000,
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
};

interface BrowserResources {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export abstract class PlaywrightBrowserClient implements IBrowserClient {
  protected readonly config: BrowserSessionConfig;
  private readonly activeResources = new Set<BrowserResources>();

  constructor(config: Partial<BrowserSessionConfig> = {}) {
    this.config = { ...DEFAULT_BROWSER_CONFIG, ...config };
  }

  abstract bootstrap(url: string): Promise<BrowserSession | null>;

  runWithSignal<T>(signal: AbortSignal, callback: () => Promise<T>): Promise<T> {
    return runWithScrapeSignal(signal, callback);
  }

  async withBrowser<T>(callback: (page: Page) => Promise<T>): Promise<T> {
    const resources = await this.acquireBrowser();
    try {
      return await this.raceWithAbort(callback(resources.page));
    } finally {
      await this.closeResources(resources);
    }
  }

  async close(): Promise<void> {
    const resources = Array.from(this.activeResources);
    await Promise.allSettled(resources.map((entry) => this.closeResources(entry)));
  }

  protected async launchBrowser(): Promise<BrowserResources> {
    const signal = getActiveScrapeSignal();
    throwIfScrapeAborted();
    const browser = await chromium.launch({
      headless: this.config.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });

    try {
      if (signal?.aborted) throw createScrapeAbortError(signal);
      const context = await browser.newContext({
        userAgent: this.config.userAgent,
        viewport: this.config.viewport,
        locale: "en-US",
      });
      if (signal?.aborted) {
        await context.close();
        throw createScrapeAbortError(signal);
      }
      const page = await context.newPage();
      if (signal?.aborted) {
        await context.close();
        throw createScrapeAbortError(signal);
      }
      const resources = { browser, context, page };
      this.activeResources.add(resources);
      return resources;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  protected async acquireBrowser(): Promise<BrowserResources> {
    const signal = getActiveScrapeSignal();
    if (!signal) return this.launchBrowser();
    if (signal.aborted) throw createScrapeAbortError(signal);

    const acquisition = this.launchBrowser();
    try {
      return await this.raceWithAbort(acquisition);
    } catch (error) {
      if (signal.aborted) {
        void acquisition.then(
          (resources) => this.closeResources(resources),
          () => undefined
        );
      }
      throw error;
    }
  }

  protected async closeResources(resources: BrowserResources): Promise<void> {
    if (!this.activeResources.delete(resources)) return;
    try {
      await resources.context.close();
    } finally {
      await resources.browser.close();
    }
  }

  protected async getCookiesAsString(context: BrowserContext): Promise<string> {
    const allCookies = await context.cookies();
    return allCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  protected async raceWithAbort<T>(operation: Promise<T>): Promise<T> {
    const signal = getActiveScrapeSignal();
    if (!signal) return operation;
    if (signal.aborted) throw this.abortReason(signal);

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(this.abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      operation.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  protected parseUrl(url: string): { protocol: string; host: string; pathname: string } | null {
    try {
      const urlObj = new URL(url);
      return {
        protocol: urlObj.protocol,
        host: urlObj.host,
        pathname: urlObj.pathname,
      };
    } catch {
      return null;
    }
  }

  private abortReason(signal: AbortSignal): unknown {
    return createScrapeAbortError(signal);
  }
}

export class GenericBrowserClient extends PlaywrightBrowserClient {
  private readonly waitForMs: number;
  private readonly csrfHeaderName: string;
  private readonly apiPathPattern: string;

  constructor(config: Partial<BrowserSessionConfig> & {
    waitForMs?: number;
    csrfHeaderName?: string;
    apiPathPattern?: string;
  } = {}) {
    super(config);
    this.waitForMs = config.waitForMs ?? 3000;
    this.csrfHeaderName = config.csrfHeaderName ?? "x-calypso-csrf-token";
    this.apiPathPattern = config.apiPathPattern ?? "/api/";
  }

  async bootstrap(url: string): Promise<BrowserSession | null> {
    const parsedUrl = this.parseUrl(url);
    if (!parsedUrl) return null;

    let resources: BrowserResources | null = null;
    try {
      resources = await this.acquireBrowser();
      const { context, page } = resources;
      let csrfToken: string | null = null;
      let detectedDomain: string | null = null;

      page.on("request", (request: Request) => {
        const headers = request.headers();
        if (headers[this.csrfHeaderName] && !csrfToken) {
          csrfToken = headers[this.csrfHeaderName];
        }

        const requestUrl = request.url();
        if (requestUrl.includes(this.apiPathPattern)) {
          const domainParam = new URL(requestUrl).searchParams.get("domain");
          if (domainParam && !detectedDomain) detectedDomain = domainParam;
        }
      });

      await this.raceWithAbort(
        page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.config.timeout,
        })
      );
      await this.raceWithAbort(page.waitForTimeout(this.waitForMs));

      const finalUrlObj = new URL(page.url());
      const baseUrl = `${finalUrlObj.protocol}//${finalUrlObj.host}`;

      if (!csrfToken) {
        const calypsoToken = (await context.cookies()).find(
          (cookie) => cookie.name === "CALYPSO_CSRF_TOKEN"
        );
        if (calypsoToken) csrfToken = calypsoToken.value;
      }

      return {
        baseUrl,
        cookies: await this.getCookiesAsString(context),
        csrfToken: csrfToken ?? undefined,
        domain: detectedDomain ?? undefined,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      console.error("[BrowserClient] Bootstrap failed:", error);
      return null;
    } finally {
      if (resources) await this.closeResources(resources);
    }
  }
}

export function createBrowserClient(config: Partial<BrowserSessionConfig> = {}): IBrowserClient {
  return new GenericBrowserClient(config);
}
