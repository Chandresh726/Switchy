import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMocks = vi.hoisted(() => {
  const state = { pageCreated: false };
  const requestListener = vi.fn();
  const page = {
    on: vi.fn((_event: string, listener: (request: unknown) => void) => {
      requestListener.mockImplementation(listener);
    }),
    goto: vi.fn(async () => undefined),
    waitForTimeout: vi.fn(async () => undefined),
    url: vi.fn(() => "https://jobs.example.com/careers"),
  };
  const context = {
    newPage: vi.fn(async () => {
      state.pageCreated = true;
      return page;
    }),
    pages: vi.fn(() => (state.pageCreated ? [page] : [])),
    cookies: vi.fn(async () => [
      { name: "session", value: "abc" },
      { name: "CALYPSO_CSRF_TOKEN", value: "cookie-token" },
    ]),
    close: vi.fn(async () => undefined),
  };
  const browser = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };
  return {
    requestListener,
    state,
    page,
    context,
    browser,
    launch: vi.fn(async () => browser),
  };
});

vi.mock("playwright", () => ({
  chromium: { launch: browserMocks.launch },
}));

import {
  BrowserSessionBootstrapError,
  GenericBrowserClient,
} from "@/lib/scraper/infrastructure/browser-client";

describe("GenericBrowserClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.state.pageCreated = false;
  });

  it("provides a page to callbacks and deterministically closes resources", async () => {
    const client = new GenericBrowserClient();

    const result = await client.withBrowser(async (page) => {
      expect(page).toBe(browserMocks.page);
      return "done";
    });

    expect(result).toBe("done");
    expect(browserMocks.context.newPage).toHaveBeenCalledTimes(1);
    expect(browserMocks.context.close).toHaveBeenCalledTimes(1);
    expect(browserMocks.browser.close).toHaveBeenCalledTimes(1);
  });

  it("closes resources when a browser callback throws", async () => {
    const client = new GenericBrowserClient();

    await expect(
      client.withBrowser(async () => {
        throw new Error("callback failed");
      })
    ).rejects.toThrow("callback failed");

    expect(browserMocks.context.close).toHaveBeenCalledTimes(1);
    expect(browserMocks.browser.close).toHaveBeenCalledTimes(1);
  });

  it("extracts cookies and the CSRF fallback during bootstrap", async () => {
    const client = new GenericBrowserClient({ waitForMs: 0 });

    const session = await client.bootstrap("https://jobs.example.com/careers");

    expect(session).toEqual({
      baseUrl: "https://jobs.example.com",
      cookies: "session=abc; CALYPSO_CSRF_TOKEN=cookie-token",
      csrfToken: "cookie-token",
      domain: undefined,
    });
    expect(browserMocks.page.goto).toHaveBeenCalledWith(
      "https://jobs.example.com/careers",
      expect.objectContaining({ waitUntil: "domcontentloaded" })
    );
    expect(browserMocks.context.close).toHaveBeenCalledTimes(1);
    expect(browserMocks.browser.close).toHaveBeenCalledTimes(1);
  });

  it("reports sanitized, retryable browser bootstrap stages", async () => {
    const client = new GenericBrowserClient({ waitForMs: 0 });
    browserMocks.page.goto.mockRejectedValueOnce(
      new Error("secret-token=do-not-persist")
    );

    const error = await client
      .bootstrap("https://jobs.example.com/careers")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BrowserSessionBootstrapError);
    expect(error).toMatchObject({ stage: "navigation", retryable: true });
    expect((error as Error).message).not.toContain("secret-token");
    expect(browserMocks.context.close).toHaveBeenCalledTimes(1);
    expect(browserMocks.browser.close).toHaveBeenCalledTimes(1);
  });

  it("classifies browser launch failures without returning null", async () => {
    const client = new GenericBrowserClient();
    browserMocks.launch.mockRejectedValueOnce(new Error("launch failed"));

    await expect(
      client.bootstrap("https://jobs.example.com/careers")
    ).rejects.toMatchObject({
      name: "BrowserSessionBootstrapError",
      stage: "launch",
      retryable: true,
    });
  });

  it("tracks concurrent browser sessions independently", async () => {
    const client = new GenericBrowserClient();
    let finishFirst: (() => void) | undefined;
    const first = client.withBrowser(
      () => new Promise<string>((resolve) => {
        finishFirst = () => resolve("first");
      })
    );
    await vi.waitFor(() => expect(browserMocks.launch).toHaveBeenCalledTimes(1));

    const second = client.withBrowser(async () => "second");
    await expect(second).resolves.toBe("second");
    expect(browserMocks.context.close).toHaveBeenCalledTimes(1);

    finishFirst?.();
    await expect(first).resolves.toBe("first");
    expect(browserMocks.context.close).toHaveBeenCalledTimes(2);
    expect(browserMocks.browser.close).toHaveBeenCalledTimes(2);
  });

  it("closes a scoped browser session when cancellation is requested", async () => {
    const client = new GenericBrowserClient();
    const controller = new AbortController();
    const operation = client.runWithSignal(controller.signal, () =>
      client.withBrowser(() => new Promise<never>(() => undefined))
    );
    await vi.waitFor(() => expect(browserMocks.launch).toHaveBeenCalledTimes(1));

    controller.abort(new DOMException("Scrape cancelled", "AbortError"));

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(browserMocks.context.close).toHaveBeenCalledTimes(1);
    expect(browserMocks.browser.close).toHaveBeenCalledTimes(1);
  });

  it("does not launch Chromium for an already-cancelled scrape", async () => {
    const client = new GenericBrowserClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Scrape cancelled", "AbortError"));

    await expect(
      client.runWithSignal(controller.signal, () =>
        client.withBrowser(async () => "unused")
      )
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(browserMocks.launch).not.toHaveBeenCalled();
  });

  it("closes a browser that finishes launching after cancellation", async () => {
    const client = new GenericBrowserClient();
    const controller = new AbortController();
    let finishLaunch: ((browser: typeof browserMocks.browser) => void) | undefined;
    browserMocks.launch.mockImplementationOnce(
      () => new Promise((resolve) => {
        finishLaunch = resolve;
      })
    );
    const operation = client.runWithSignal(controller.signal, () =>
      client.withBrowser(async () => "unused")
    );
    const rejection = expect(operation).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(browserMocks.launch).toHaveBeenCalledTimes(1));

    controller.abort(new DOMException("Scrape cancelled", "AbortError"));
    await rejection;
    finishLaunch?.(browserMocks.browser);

    await vi.waitFor(() => expect(browserMocks.browser.close).toHaveBeenCalledTimes(1));
    expect(browserMocks.browser.newContext).not.toHaveBeenCalled();
  });
});
