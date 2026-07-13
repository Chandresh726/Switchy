import { isRetryableError } from "./errors";

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  onRetry?: (attempt: number, delay: number, error: Error) => number | void;
  onAttempt?: (attempt: number) => void;
  signal?: AbortSignal;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Matching was aborted", "AbortError");
}

export async function abortableDelay(
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Matching was aborted", "AbortError")
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { maxRetries, baseDelay, maxDelay, onRetry, onAttempt, signal } = options;
  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    throwIfAborted(signal);
    onAttempt?.(attempt);
    try {
      const result = await fn();
      throwIfAborted(signal);
      return result;
    } catch (error) {
      throwIfAborted(signal);
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryableError(lastError)) {
        console.log(`[Retry] Non-retryable error, failing fast: ${lastError.name} - ${lastError.message}`);
        throw lastError;
      }

      if (attempt === maxRetries) {
        break;
      }

      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = Math.random() * 1000;
      let delay = exponentialDelay + jitter;

      const overrideDelay = onRetry?.(attempt, delay, lastError);
      if (typeof overrideDelay === "number" && overrideDelay > 0) {
        delay = Math.min(overrideDelay, maxDelay);
      }

      await abortableDelay(delay, signal);
    }
  }

  throw lastError;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string = "Operation",
  signal?: AbortSignal
): Promise<T> {
  throwIfAborted(signal);
  let timeoutId: ReturnType<typeof setTimeout>;
  let removeAbortListener: () => void = () => undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${operation} timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });

  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        let settled = false;
        const onAbort = () => {
          if (settled) return;
          settled = true;
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException("Matching was aborted", "AbortError")
          );
        };
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", onAbort);
        if (signal.aborted) onAbort();
      })
    : new Promise<never>(() => undefined);

  try {
    const result = await Promise.race([promise, timeoutPromise, abortPromise]);
    clearTimeout(timeoutId!);
    removeAbortListener();
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    removeAbortListener();
    throw error;
  }
}
