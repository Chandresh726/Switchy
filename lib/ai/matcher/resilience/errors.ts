import type { ErrorType } from "../types";

const SERVER_ERROR_CODES = ["502", "503", "504", "529"];
const RATE_LIMIT_CODES = ["429"];

export class MatcherError extends Error {
  constructor(
    message: string,
    public readonly type: ErrorType,
    public readonly retryable: boolean,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = "MatcherError";
    Error.captureStackTrace(this, this.constructor);
  }
}

export class MatcherValidationError extends MatcherError {
  constructor(message: string, originalError?: Error) {
    super(message, "validation", false, originalError);
    this.name = "MatcherValidationError";
  }
}

export class MatcherProviderError extends MatcherError {
  constructor(message: string, retryable: boolean, originalError?: Error) {
    super(message, retryable ? "rate_limit" : "unknown", retryable, originalError);
    this.name = "MatcherProviderError";
  }
}

export class MatcherTimeoutError extends MatcherError {
  constructor(message: string, originalError?: Error) {
    super(message, "timeout", true, originalError);
    this.name = "MatcherTimeoutError";
  }
}

export function isServerError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const statusMatch = message.match(/(?:status|http|error)[:\s]*(\d{3})/i);
  if (statusMatch && SERVER_ERROR_CODES.includes(statusMatch[1])) {
    return true;
  }
  if (SERVER_ERROR_CODES.some((code) => message.includes(code))) {
    return true;
  }
  if (
    message.includes("bad gateway") ||
    message.includes("service unavailable") ||
    message.includes("gateway timeout") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable")
  ) {
    return true;
  }
  return false;
}

export function isRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const statusMatch = message.match(/(?:status|http|error)[:\s]*(\d{3})/i);
  if (statusMatch && RATE_LIMIT_CODES.includes(statusMatch[1])) {
    return true;
  }
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("tokens per") ||
    message.includes("token limit") ||
    message.includes("quota") ||
    message.includes("throttl")
  );
}

export function categorizeError(error: Error): ErrorType {
  const message = error.message.toLowerCase();
  const name = error.name || "";

  if (name.includes("MatcherValidationError")) {
    return "validation";
  }
  if (name.includes("CircuitBreakerOpenError") || message.includes("circuit breaker")) {
    return "circuit_breaker";
  }
  if (name.includes("NoObjectGeneratedError") || message.includes("no object generated")) {
    return "no_object";
  }
  if (
    name.includes("GenerateObjectError") ||
    message.includes("generate object") ||
    message.includes("object generation")
  ) {
    if (message.includes("validation") || message.includes("schema")) {
      return "validation";
    }
    if (isRateLimitError(error)) {
      return "rate_limit";
    }
    return "unknown";
  }
  if (message.includes("timeout") || message.includes("timed out") || name.includes("TimeoutError")) {
    return "timeout";
  }
  if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
    return "network";
  }
  if (isServerError(error) || isRateLimitError(error)) {
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

export function isRetryableError(error: Error): boolean {
  const errorType = categorizeError(error);
  const nonRetryableErrors: ErrorType[] = ["validation", "circuit_breaker", "json_parse", "no_object"];
  return !nonRetryableErrors.includes(errorType);
}

export function createMatcherError(
  type: ErrorType,
  message: string,
  originalError?: Error
): MatcherError {
  switch (type) {
    case "validation":
      return new MatcherValidationError(message, originalError);
    case "timeout":
      return new MatcherTimeoutError(message, originalError);
    case "rate_limit":
    case "network":
      return new MatcherProviderError(message, true, originalError);
    default:
      return new MatcherError(message, type, false, originalError);
  }
}
