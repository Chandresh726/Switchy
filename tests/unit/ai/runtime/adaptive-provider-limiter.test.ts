import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdaptiveProviderLimiter,
  type AdaptiveProviderPermit,
} from "@/lib/ai/runtime/adaptive-provider-limiter";
import { AIRateLimitError } from "@/lib/ai/shared/errors";

async function recordSuccesses(
  limiter: AdaptiveProviderLimiter,
  providerRecordId: string,
  ceiling: number,
  count: number
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const permit = await limiter.acquire(providerRecordId, ceiling);
    permit.success();
  }
}

describe("AdaptiveProviderLimiter", () => {
  afterEach(() => vi.useRealTimers());
  it("caps jittered backoff at thirty minutes while honoring longer Retry-After values", async () => {
    vi.useFakeTimers();
    const limiter = new AdaptiveProviderLimiter();
    for (let attempt = 0; attempt < 12; attempt++) {
      const permit = await limiter.acquire("a", 1);
      const now = Date.now();
      permit.failure(new AIRateLimitError("limited"));
      const until = limiter.getSnapshot("a")!.cooldownUntil;
      expect(until - now).toBeLessThanOrEqual(30 * 60_000);
      await vi.advanceTimersByTimeAsync(Math.ceil(until - now));
    }
    const permit = await limiter.acquire("a", 1);
    const now = Date.now();
    permit.failure(new AIRateLimitError("limited", undefined, 3_600_000));
    expect(limiter.getSnapshot("a")!.cooldownUntil - now).toBe(3_600_000);
  });
  it("isolates concurrency by concrete provider record", async () => {
    const limiter = new AdaptiveProviderLimiter();
    const firstProviderPermit = await limiter.acquire("provider-a", 1);
    let secondProviderPermit: AdaptiveProviderPermit | undefined;
    const waiting = limiter.acquire("provider-a", 1).then((permit) => {
      secondProviderPermit = permit;
      return permit;
    });

    await Promise.resolve();
    expect(secondProviderPermit).toBeUndefined();

    const independentPermit = await limiter.acquire("provider-b", 1);
    expect(limiter.getSnapshot("provider-b")).toMatchObject({
      currentLimit: 1,
      active: 1,
      waiting: 0,
    });

    independentPermit.success();
    firstProviderPermit.success();
    (await waiting).success();
  });

  it("rejects queued permits when another execution restores an account cooldown", async () => {
    const limiter = new AdaptiveProviderLimiter();
    const active = await limiter.acquire("account", 1);
    const waiting = limiter.acquire("account", 1);
    const rejected = expect(waiting).rejects.toMatchObject({ type: "rate_limit" });
    limiter.restoreCooldown("account", 1, Date.now() + 120_000);
    await rejected;
    active.release();
    expect(limiter.getSnapshot("account")).toMatchObject({ active: 0, waiting: 0, consecutiveSuccesses: 0 });
  });

  it("drops to a single recovery probe after a rate-limit response", async () => {
    const limiter = new AdaptiveProviderLimiter();
    const permit = await limiter.acquire("provider-a", 4);

    permit.failure(new AIRateLimitError("Provider rate limited the request"));

    expect(limiter.getSnapshot("provider-a")).toMatchObject({
      ceiling: 4,
      currentLimit: 1,
      active: 0,
      consecutiveSuccesses: 0,
    });
  });

  it("increases by one after twenty consecutive successes", async () => {
    vi.useFakeTimers();
    const limiter = new AdaptiveProviderLimiter();
    const permit = await limiter.acquire("provider-a", 3);
    permit.failure(new AIRateLimitError("429 Too Many Requests"));

    await vi.advanceTimersByTimeAsync(36_001);
    await recordSuccesses(limiter, "provider-a", 3, 19);
    expect(limiter.getSnapshot("provider-a")?.currentLimit).toBe(1);

    await recordSuccesses(limiter, "provider-a", 3, 1);
    expect(limiter.getSnapshot("provider-a")).toMatchObject({
      ceiling: 3,
      currentLimit: 2,
      consecutiveSuccesses: 0,
    });
  });

  it("rejects queued work during cooldown and permits only one recovery probe", async () => {
    vi.useFakeTimers();
    const limiter = new AdaptiveProviderLimiter();
    const permit = await limiter.acquire("a", 1);
    const waiting = limiter.acquire("a", 1);
    const rejected = expect(waiting).rejects.toMatchObject({ type: "rate_limit" });
    permit.failure(new AIRateLimitError("limited", undefined, 120_000));
    await rejected;
    await expect(limiter.acquire("a", 5)).rejects.toMatchObject({ type: "rate_limit" });
    (await limiter.acquire("b", 1)).success();
    await vi.advanceTimersByTimeAsync(120_001);
    const probe = await limiter.acquire("a", 5);
    expect(limiter.getSnapshot("a")).toMatchObject({ currentLimit: 1, active: 1 });
    probe.success();
  });

  it("never grows beyond the configured ceiling", async () => {
    const limiter = new AdaptiveProviderLimiter();

    await recordSuccesses(limiter, "provider-a", 2, 60);

    expect(limiter.getSnapshot("provider-a")).toMatchObject({
      ceiling: 2,
      currentLimit: 2,
    });
  });

  it("removes and rejects a cancelled waiter without consuming capacity", async () => {
    const limiter = new AdaptiveProviderLimiter();
    const activePermit = await limiter.acquire("provider-a", 1);
    const controller = new AbortController();
    const reason = new DOMException("matching cancelled", "AbortError");
    const waiting = limiter.acquire("provider-a", 1, controller.signal);

    controller.abort(reason);

    await expect(waiting).rejects.toBe(reason);
    expect(limiter.getSnapshot("provider-a")).toMatchObject({
      active: 1,
      waiting: 0,
    });

    activePermit.success();
    expect(limiter.getSnapshot("provider-a")?.active).toBe(0);
  });
});
