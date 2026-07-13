export interface RetryPolicy {
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
}

function getRetryAfterMs(error: unknown): number {
  if (
    !error ||
    typeof error !== "object" ||
    !("retryAfterMs" in error) ||
    typeof error.retryAfterMs !== "number" ||
    !Number.isFinite(error.retryAfterMs)
  ) {
    return 0;
  }
  return Math.max(0, error.retryAfterMs);
}

export function resolveRetryDelay(
  attemptCount: number,
  error: unknown,
  policy: RetryPolicy
): number {
  const baseDelay = Math.max(0, policy.baseRetryDelayMs);
  const maxDelay = Math.max(0, policy.maxRetryDelayMs);
  const exponentialDelay = Math.min(
    maxDelay,
    baseDelay * 2 ** Math.max(0, attemptCount - 1)
  );
  return Math.min(
    maxDelay,
    Math.max(exponentialDelay, getRetryAfterMs(error))
  );
}
