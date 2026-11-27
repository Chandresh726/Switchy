import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FetchHttpClient } from "@/lib/scraper/infrastructure/http-client";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("coordinated HTTP pacing", () => {
  it("spaces parallel request starts without serializing unrelated hosts", async () => {
    const starts: Array<{ url: string; at: number }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { starts.push({ url, at: Date.now() }); return Response.json({}); }));
    const client = new FetchHttpClient();
    const pending = Promise.all([
      client.get("https://one.example/a", { minIntervalMs: 1000 }),
      client.get("https://one.example/b", { minIntervalMs: 1000 }),
      client.get("https://one.example/c", { minIntervalMs: 1000 }),
      client.get("https://two.example/a", { minIntervalMs: 1000 }),
    ]);
    await vi.runAllTimersAsync();
    await pending;
    expect(starts.filter((entry) => entry.url.includes("one.example")).map((entry) => entry.at)).toEqual([0, 1000, 2000]);
    expect(starts.find((entry) => entry.url.includes("two.example"))?.at).toBe(0);
  });

  it("adds no fixed post-response pause when the HTTP request already exceeded the minimum interval", async () => {
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now()); await new Promise((resolve) => setTimeout(resolve, 2000)); return Response.json({});
    }));
    const client = new FetchHttpClient();
    const pending = (async () => {
      await client.get("https://example.com/one", { minIntervalMs: 1500 });
      await client.get("https://example.com/two", { minIntervalMs: 1500 });
    })();
    await vi.runAllTimersAsync(); await pending;
    expect(starts).toEqual([0, 2000]);
  });

  it("backs off after a real throttle and gradually recovers after successful responses", async () => {
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => { starts.push(Date.now()); return new Response("{}", { status: starts.length === 1 ? 429 : 200 }); }));
    const client = new FetchHttpClient({ retries: 0 });
    const options = { minIntervalMs: 100, adaptivePacing: { maxIntervalMs: 400, recoverySuccesses: 2 } };
    const pending = (async () => {
      await client.fetch("https://example.com/limited", options);
      for (let i = 0; i < 3; i++) await client.get(`https://example.com/${i}`, options);
    })();
    await vi.runAllTimersAsync(); await pending;
    expect(starts).toEqual([0, 200, 400, 560]);
  });

  it("releases an aborted pacing waiter without delaying or cancelling its peers", async () => {
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => { starts.push(Date.now()); return Response.json({}); }));
    const client = new FetchHttpClient();
    await client.get("https://example.com/first", { minIntervalMs: 1000 });
    const controller = new AbortController();
    const aborted = expect(client.get("https://example.com/abort", { minIntervalMs: 1000, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    const surviving = client.get("https://example.com/last", { minIntervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(50); controller.abort();
    await vi.runAllTimersAsync(); await aborted; await surviving;
    expect(starts).toEqual([0, 1000]);
  });

  it("does not treat a Cloudflare challenge as an adaptive throttle", async () => {
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now());
      return starts.length === 1
        ? new Response("challenge", { status: 429, headers: { "cf-mitigated": "challenge" } })
        : Response.json({});
    }));
    const client = new FetchHttpClient({ retries: 0 });
    const options = { minIntervalMs: 100, adaptivePacing: { maxIntervalMs: 400, recoverySuccesses: 5 } };
    const pending = (async () => {
      await expect(client.get("https://example.com/first", options)).rejects.toMatchObject({ isBrowserChallenge: true });
      await client.get("https://example.com/second", options);
    })();
    await vi.runAllTimersAsync();
    await pending;
    expect(starts).toEqual([0, 100]);
  });

  it("rechecks pacing when a response raises the penalty while another request is waiting", async () => {
    const starts: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => {
      starts.push(Date.now());
      if (starts.length === 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return new Response("{}", { status: 429 });
      }
      return Response.json({});
    }));
    const client = new FetchHttpClient({ retries: 0 });
    const options = { minIntervalMs: 100, adaptivePacing: { maxIntervalMs: 400, recoverySuccesses: 5 } };
    const pending = Promise.all([
      client.fetch("https://example.com/first", options),
      client.get("https://example.com/second", options),
    ]);
    await vi.runAllTimersAsync();
    await pending;
    expect(starts).toEqual([0, 200]);
  });
});
