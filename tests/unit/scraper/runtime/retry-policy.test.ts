import { describe, expect, it } from "vitest";

import { resolveRetryDelay } from "@/lib/scraper/runtime/retry-policy";

const policy = {
  baseRetryDelayMs: 100,
  maxRetryDelayMs: 1_000,
};

describe("resolveRetryDelay", () => {
  it.each([
    { attemptCount: 0, expected: 100 },
    { attemptCount: 1, expected: 100 },
    { attemptCount: 2, expected: 200 },
    { attemptCount: 5, expected: 1_000 },
  ])("bounds exponential delay for attempt $attemptCount", ({ attemptCount, expected }) => {
    expect(resolveRetryDelay(attemptCount, null, policy)).toBe(expected);
  });

  it("honors retry-after without exceeding the maximum", () => {
    expect(resolveRetryDelay(1, { retryAfterMs: 750 }, policy)).toBe(750);
    expect(resolveRetryDelay(1, { retryAfterMs: 2_000 }, policy)).toBe(1_000);
  });

  it("ignores invalid retry-after values", () => {
    expect(resolveRetryDelay(2, { retryAfterMs: Number.NaN }, policy)).toBe(200);
    expect(resolveRetryDelay(2, { retryAfterMs: -1 }, policy)).toBe(200);
  });
});
