/**
 * Decides whether a rate-limited company may wait for another attempt inside
 * the current session. Anything else ends now and retries at the next
 * scheduled run, so a blocked source cannot hold a session open.
 */
export const SCRAPE_RATE_LIMIT_POLICY = {
  minRetryDelayMs: 30_000,
  maxRetryDelayMs: 5 * 60_000,
  maxCompanyWaitMs: 15 * 60_000,
} as const;

export const RATE_LIMIT_NEXT_RUN_MESSAGE = "Rate limited by the source; will retry at the next scheduled run.";

export function canRetryRateLimitInSession(input: {
  firstStartedAt: Date;
  now: Date;
  retryAfterMs?: number;
  /** The attempt received at least one successful response before the limit. */
  progressed: boolean;
}): boolean {
  if (!input.progressed) return false;
  const delay = Math.max(SCRAPE_RATE_LIMIT_POLICY.minRetryDelayMs, input.retryAfterMs ?? 0);
  if (delay > SCRAPE_RATE_LIMIT_POLICY.maxRetryDelayMs) return false;
  return input.now.getTime() + delay < input.firstStartedAt.getTime() + SCRAPE_RATE_LIMIT_POLICY.maxCompanyWaitMs;
}
