import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FetchHttpClient, HttpError } from "@/lib/scraper/infrastructure/http-client";
import { createScrapeMetrics, withScrapeMetrics } from "@/lib/scraper/infrastructure/metrics";

describe("FetchHttpClient", () => {
  it("records actual requests, retry waits, and pacing separately for a scrape", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("retry", { status: 503 }))
      .mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const metrics = createScrapeMetrics(0);
    const client = new FetchHttpClient({ baseDelay: 100, jitterRatio: 0, retries: 1 });
    const pending = withScrapeMetrics(metrics, async () => {
      await client.get("https://example.com/one", { minIntervalMs: 1500 });
      await client.get("https://example.com/two", { minIntervalMs: 1500 });
    });
    await vi.runAllTimersAsync();
    await pending;
    expect(metrics.httpRequests).toBe(3);
    expect(metrics.retries).toBe(1);
    expect(metrics.retryWaitMs).toBe(100);
    expect(metrics.pacingWaitMs).toBeGreaterThanOrEqual(1500);
    expect(metrics.httpMs).toBeLessThan(metrics.pacingWaitMs);
  });

  it("keeps concurrent companies' HTTP metrics isolated", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    const one = createScrapeMetrics(0);
    const two = createScrapeMetrics(0);
    const client = new FetchHttpClient();
    await Promise.all([
      withScrapeMetrics(one, () => client.get("https://one.example.com/jobs")),
      withScrapeMetrics(two, async () => {
        await client.get("https://two.example.com/jobs");
        await client.get("https://two.example.com/details");
      }),
    ]);
    expect(one.httpRequests).toBe(1);
    expect(two.httpRequests).toBe(2);
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns long Retry-After to the queue and shares durable host cooldowns", async () => {
    const values = new Map<string, unknown>();
    const state = { get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => { values.set(key, value); },
      delete: (key: string) => { values.delete(key); } };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("limited", { status: 429, headers: { "Retry-After": "120" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchHttpClient({ retries: 3, maxDelay: 16_000 }, state);
    await expect(client.post("https://example.com/jobs", {})).rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 });
    // New client represents a restarted worker using the same persisted state.
    const restarted = new FetchHttpClient({}, state);
    await expect(restarted.get("https://example.com/other-page")).rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry or persist cooldowns for browser challenges", async () => {
    const state = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("challenge", {
      status: 429, headers: { "cf-mitigated": "challenge", "content-type": "text/html" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchHttpClient({ retries: 3 }, state);
    await expect(client.post("https://example.com/jobs", {})).rejects.toMatchObject({
      isBrowserChallenge: true, isRateLimited: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.set).not.toHaveBeenCalled();
  });

  it("paces transport attempts and relaxes cooldown strikes after successful requests", async () => {
    const values = new Map<string, unknown>([["cooldown:example.com", { until: 0, strikes: 5 }]]);
    const state = { get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => { values.set(key, value); },
      delete: (key: string) => { values.delete(key); } };
    const transport = vi.fn(async () => new Response("{}"));
    const client = new FetchHttpClient({}, state);
    await client.get("https://example.com/one", { transport, minIntervalMs: 1500 });
    const second = client.get("https://example.com/two", { transport, minIntervalMs: 1500 });
    await vi.advanceTimersByTimeAsync(1499);
    expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(transport).toHaveBeenCalledTimes(2);
    expect(values.get("cooldown:example.com")).toEqual({ until: 0, strikes: 3 });
  });

  it("never truncates a long server-requested wait even without a state store", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(
      new Response("busy", { status: 503, headers: { "Retry-After": "120" } })));
    await expect(new FetchHttpClient({ maxDelay: 16_000 }).get("https://example.com/jobs"))
      .rejects.toMatchObject({ status: 503, retryAfterMs: 120_000 });
  });

  it("retries server failures with exponential delays", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchHttpClient({
      retries: 2,
      baseDelay: 10,
      maxDelay: 20,
      jitterRatio: 0,
    });

    const responsePromise = client.fetch("https://example.com/jobs");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(19);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry ordinary client errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("bad request", { status: 400, statusText: "Bad Request" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchHttpClient({ retries: 3, baseDelay: 10 });

    const response = await client.fetch("https://example.com/jobs");

    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transport failures and exposes typed errors from convenience methods", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("socket closed"))
      .mockResolvedValueOnce(
        new Response("missing", { status: 404, statusText: "Not Found" })
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchHttpClient({ retries: 1, baseDelay: 10, jitterRatio: 0 });

    const requestPromise = client.get("https://example.com/jobs");
    const rejection = expect(requestPromise).rejects.toMatchObject({
      name: "HttpError",
      status: 404,
      isClientError: true,
    } satisfies Partial<HttpError>);
    await vi.runAllTimersAsync();

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After for rate limits", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, headers: { "Retry-After": "0.05" } })
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchHttpClient({ retries: 1, maxDelay: 100, jitterRatio: 0 });

    const responsePromise = client.fetch("https://example.com/jobs");
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels in-flight scoped requests without retrying", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, options) => ({
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      url: "https://example.com/jobs",
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Scrape cancelled", "AbortError"));
        });
      }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchHttpClient({ retries: 3, jitterRatio: 0 });
    const controller = new AbortController();

    const request = client.runWithSignal(controller.signal, () =>
      client.fetch("https://example.com/jobs")
    );
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new DOMException("Scrape cancelled", "AbortError"));

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the request timeout active while consuming the response body", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, options) => ({
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      url: "https://example.com/jobs",
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(options.signal?.reason);
        });
      }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchHttpClient({ timeout: 25, retries: 0 });

    const request = client.fetch("https://example.com/jobs");
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });

  it("holds the per-host slot until the response body is consumed", async () => {
    let finishFirstBody: (() => void) | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        async () =>
          new Response(
            new ReadableStream({
              start(streamController) {
                finishFirstBody = () => {
                  streamController.enqueue(new TextEncoder().encode("first"));
                  streamController.close();
                };
              },
            })
          )
      )
      .mockResolvedValueOnce(new Response("second", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new FetchHttpClient({ maxConcurrencyPerHost: 1, retries: 0 });

    const first = client.fetch("https://example.com/jobs/1");
    const second = client.fetch("https://example.com/jobs/2");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    finishFirstBody?.();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    await second;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rejects oversized declared and streamed responses without retrying", async () => {
    for (const headers of [new Headers({ "content-length": "10" }), new Headers()]) {
      const fetch = vi.fn(async () => new Response("0123456789", { headers }));
      vi.stubGlobal("fetch", fetch);
      const client = new FetchHttpClient({ maxResponseBytes: 5, retries: 3 });
      await expect(client.fetch("https://example.com/jobs")).rejects.toMatchObject({ status: 413 });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

});
