import type { ErrorType } from "./types";

/**
 * Categorize an error into a specific error type
 * Used for logging and circuit breaker decisions
 */
export function categorizeError(error: Error): ErrorType {
  const message = error.message.toLowerCase();
  const name = error.name || "";

  if (name.includes("CircuitBreakerOpenError") || message.includes("circuit breaker")) {
    return "circuit_breaker";
  }
  if (name.includes("NoObjectGeneratedError") || message.includes("no object generated")) {
    return "no_object";
  }
  if (message.includes("timeout") || message.includes("timed out") || name.includes("TimeoutError")) {
    return "timeout";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
    return "network";
  }
  if (message.includes("rate limit") || message.includes("429") || message.includes("too many requests") || message.includes("tokens per") || message.includes("token limit") || message.includes("quota")) {
    return "rate_limit";
  }
  if (message.includes("json") || message.includes("parse") || message.includes("unexpected token") || message.includes("syntax")) {
    return "json_parse";
  }
  if (message.includes("validation") || message.includes("zod") || message.includes("invalid") || message.includes("schema")) {
    return "validation";
  }

  return "unknown";
}

/**
 * Check if an error is retryable
 * Used to decide whether to retry or fail immediately
 */
export function isRetryableError(error: Error): boolean {
  const errorType = categorizeError(error);
  const nonRetryableErrors: ErrorType[] = ["validation", "circuit_breaker"];
  return !nonRetryableErrors.includes(errorType);
}

/**
 * Create a standardized error for matcher operations
 */
export function createMatcherError(
  type: ErrorType,
  message: string,
  originalError?: Error
): Error {
  const error = new Error(message);
  error.name = `Matcher${type.charAt(0).toUpperCase() + type.slice(1)}Error`;
  if (originalError) {
    error.cause = originalError;
  }
  return error;
}
