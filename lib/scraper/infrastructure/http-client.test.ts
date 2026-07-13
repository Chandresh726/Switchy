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
    const client = new FetchHttpClient({ retries: 2, baseDelay: 10, maxDelay: 20 });

    const responsePromise = client.fetch("https://example.com/jobs");
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
    const client = new FetchHttpClient({ retries: 1, baseDelay: 10 });

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
});
