import { describe, expect, it } from "vitest";

import { canRetryRateLimitInSession } from "@/lib/scraper/queue/rate-limit-policy";

const firstStartedAt = new Date("2026-11-27T17:30:00Z");
const minutes = (value: number) => new Date(firstStartedAt.getTime() + value * 60_000);

describe("in-session rate-limit retries", () => {
  it("ends a source that rate limits before returning any successful response", () => {
    expect(canRetryRateLimitInSession({ firstStartedAt, now: minutes(0), retryAfterMs: 60_000, progressed: false })).toBe(false);
  });

  it("waits briefly for a source that is making progress", () => {
    expect(canRetryRateLimitInSession({ firstStartedAt, now: minutes(2), retryAfterMs: 120_000, progressed: true })).toBe(true);
    expect(canRetryRateLimitInSession({ firstStartedAt, now: minutes(2), progressed: true })).toBe(true);
  });

  it("does not hold the session for long cooldowns or past the company budget", () => {
    expect(canRetryRateLimitInSession({ firstStartedAt, now: minutes(1), retryAfterMs: 16 * 60_000, progressed: true })).toBe(false);
    expect(canRetryRateLimitInSession({ firstStartedAt, now: minutes(13), retryAfterMs: 3 * 60_000, progressed: true })).toBe(false);
  });
});
