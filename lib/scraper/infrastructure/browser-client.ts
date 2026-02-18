import { chromium } from "playwright";
import type { Browser, BrowserContext, Page, Request } from "playwright";

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
  close(): Promise<void>;
}

export const DEFAULT_BROWSER_CONFIG: BrowserSessionConfig = {
  headless: true,
  timeout: 30000,
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
};

export abstract class PlaywrightBrowserClient implements IBrowserClient {
  protected browser: Browser | null = null;
  protected context: BrowserContext | null = null;
  protected readonly config: BrowserSessionConfig;

  constructor(config: Partial<BrowserSessionConfig> = {}) {
    this.config = { ...DEFAULT_BROWSER_CONFIG, ...config };
  }

  abstract bootstrap(url: string): Promise<BrowserSession | null>;

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  protected async launchBrowser(): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });

    this.context = await this.browser.newContext({
      userAgent: this.config.userAgent,
      viewport: this.config.viewport,
      locale: "en-US",
    });

    const page = await this.context.newPage();
    return { browser: this.browser, context: this.context, page };
  }

  protected async getCookiesAsString(): Promise<string> {
    if (!this.context) return "";
    const allCookies = await this.context.cookies();
    return allCookies.map((c) => `${c.name}=${c.value}`).join("; ");
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
    try {
      const { page } = await this.launchBrowser();
      const parsedUrl = this.parseUrl(url);
      
      if (!parsedUrl) {
        await this.close();
        return null;
      }

      let csrfToken: string | null = null;
      let detectedDomain: string | null = null;

      page.on("request", (request: Request) => {
        const headers = request.headers();
        if (headers[this.csrfHeaderName] && !csrfToken) {
          csrfToken = headers[this.csrfHeaderName];
        }

        const requestUrl = request.url();
        if (requestUrl.includes(this.apiPathPattern)) {
          const urlObj = new URL(requestUrl);
          const domainParam = urlObj.searchParams.get("domain");
          if (domainParam && !detectedDomain) {
            detectedDomain = domainParam;
          }
        }
      });

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.config.timeout,
      });

      await page.waitForTimeout(this.waitForMs);

      const finalUrl = page.url();
      const finalUrlObj = new URL(finalUrl);
      const baseUrl = `${finalUrlObj.protocol}//${finalUrlObj.host}`;

      if (!csrfToken && this.context) {
        const calypsoToken = await this.context
          .cookies()
          .then((c) => c.find((x) => x.name === "CALYPSO_CSRF_TOKEN"));
        if (calypsoToken) csrfToken = calypsoToken.value;
      }

      const cookies = await this.getCookiesAsString();

      await this.close();

      return {
        baseUrl,
        cookies,
        csrfToken: csrfToken ?? undefined,
        domain: detectedDomain ?? undefined,
      };
    } catch (error) {
      await this.close();
      console.error("[BrowserClient] Bootstrap failed:", error);
      return null;
    }
  }
}

export function createBrowserClient(config: Partial<BrowserSessionConfig> = {}): IBrowserClient {
  return new GenericBrowserClient(config);
}
