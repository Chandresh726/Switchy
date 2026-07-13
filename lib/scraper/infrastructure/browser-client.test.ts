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

import { GenericBrowserClient } from "@/lib/scraper/infrastructure/browser-client";

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
});
