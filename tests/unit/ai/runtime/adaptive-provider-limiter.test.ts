import { describe, expect, it } from "vitest";

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

  it("reduces concurrency by one after a rate-limit response", async () => {
    const limiter = new AdaptiveProviderLimiter();
    const permit = await limiter.acquire("provider-a", 4);

    permit.failure(new AIRateLimitError("Provider rate limited the request"));

    expect(limiter.getSnapshot("provider-a")).toMatchObject({
      ceiling: 4,
      currentLimit: 3,
      active: 0,
      consecutiveSuccesses: 0,
    });
  });

  it("increases by one after twenty consecutive successes", async () => {
    const limiter = new AdaptiveProviderLimiter();
    const permit = await limiter.acquire("provider-a", 3);
    permit.failure(new AIRateLimitError("429 Too Many Requests"));

    await recordSuccesses(limiter, "provider-a", 3, 19);
    expect(limiter.getSnapshot("provider-a")?.currentLimit).toBe(2);

    await recordSuccesses(limiter, "provider-a", 3, 1);
    expect(limiter.getSnapshot("provider-a")).toMatchObject({
      ceiling: 3,
      currentLimit: 3,
      consecutiveSuccesses: 0,
    });
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
