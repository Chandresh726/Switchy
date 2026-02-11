
/**
 * Timeout wrapper for async operations
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string = "Operation"
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${operation} timed out after ${timeoutMs}ms`);
      error.name = "TimeoutError";
      reject(error);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

/**
 * Retry function with exponential backoff and jitter
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    jobId?: number;
    scrapingLogId?: number | null;
    logError?: (attempt: number, error: Error) => Promise<void>;
    onRetry?: (attempt: number, delay: number, error: Error) => void;
  }
): Promise<T> {
  const { maxRetries, baseDelay, maxDelay, logError, onRetry } = options;
  let lastError: Error = new Error("Unknown error");

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Log error for each attempt if handler provided
      if (logError) {
        await logError(attempt, lastError);
      }

      if (attempt === maxRetries) {
        // Final attempt failed
        break;
      }

      // Exponential backoff with jitter: baseDelay * 2^attempt + random jitter
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = Math.random() * 1000; // Up to 1s of random jitter
      const delay = exponentialDelay + jitter;

      onRetry?.(attempt, delay, lastError);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
