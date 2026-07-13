import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FetchHttpClient, HttpError } from "@/lib/scraper/infrastructure/http-client";

describe("FetchHttpClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
});
