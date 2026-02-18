export type AIErrorType =
  | "provider_not_found"
  | "missing_api_key"
  | "invalid_model"
  | "reasoning_not_supported"
  | "generation_failed"
  | "decryption_failed"
  | "timeout"
  | "rate_limit"
  | "network"
  | "validation"
  | "json_parse"
  | "no_object"
  | "circuit_breaker"
  | "unknown";

export interface AIErrorOptions {
  type: AIErrorType;
  message: string;
  cause?: Error;
  retryable?: boolean;
  context?: Record<string, unknown>;
}

export class AIError extends Error {
  public readonly type: AIErrorType;
  public readonly retryable: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(options: AIErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AIError";
    this.type = options.type;
    this.retryable = options.retryable ?? AIError.isRetryableType(options.type);
    this.context = options.context;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static isRetryableType(type: AIErrorType): boolean {
    const nonRetryableTypes: AIErrorType[] = [
      "provider_not_found",
      "missing_api_key",
      "invalid_model",
      "reasoning_not_supported",
      "decryption_failed",
      "validation",
      "json_parse",
      "no_object",
    ];
    return !nonRetryableTypes.includes(type);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

export class AIProviderError extends AIError {
  constructor(message: string, options?: { cause?: Error; retryable?: boolean }) {
    super({
      type: "generation_failed",
      message,
      cause: options?.cause,
      retryable: options?.retryable ?? true,
    });
    this.name = "AIProviderError";
  }
}

export class AITimeoutError extends AIError {
  constructor(message: string, cause?: Error) {
    super({
      type: "timeout",
      message,
      cause,
      retryable: true,
    });
    this.name = "AITimeoutError";
  }
}

export class AIRateLimitError extends AIError {
  constructor(message: string, cause?: Error) {
    super({
      type: "rate_limit",
      message,
      cause,
      retryable: true,
    });
    this.name = "AIRateLimitError";
  }
}

export class AIValidationError extends AIError {
  constructor(message: string, cause?: Error) {
    super({
      type: "validation",
      message,
      cause,
      retryable: false,
    });
    this.name = "AIValidationError";
  }
}

export class AINetworkError extends AIError {
  constructor(message: string, cause?: Error) {
    super({
      type: "network",
      message,
      cause,
      retryable: true,
    });
    this.name = "AINetworkError";
  }
}

export class AICircuitBreakerError extends AIError {
  constructor(message: string, cause?: Error) {
    super({
      type: "circuit_breaker",
      message,
      cause,
      retryable: false,
    });
    this.name = "AICircuitBreakerError";
  }
}

const SERVER_ERROR_CODES = ["502", "503", "504", "529"];
const RATE_LIMIT_CODES = ["429"];

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

export function categorizeError(error: Error): AIErrorType {
  const message = error.message.toLowerCase();
  const name = error.name || "";

  if (error instanceof AIValidationError) {
    return "validation";
  }
  if (error instanceof AICircuitBreakerError) {
    return "circuit_breaker";
  }
  if (error instanceof AITimeoutError) {
    return "timeout";
  }
  if (error instanceof AIRateLimitError) {
    return "rate_limit";
  }
  if (error instanceof AINetworkError) {
    return "network";
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
  if (
    message.includes("json") ||
    message.includes("parse") ||
    message.includes("unexpected token") ||
    message.includes("syntax")
  ) {
    return "json_parse";
  }
  if (
    message.includes("validation") ||
    message.includes("zod") ||
    message.includes("invalid") ||
    message.includes("schema")
  ) {
    return "validation";
  }

  return "unknown";
}

export function isRetryableError(error: Error): boolean {
  if (error instanceof AIError) {
    return error.retryable;
  }
  const errorType = categorizeError(error);
  return AIError.isRetryableType(errorType);
}

export function createAIError(
  type: AIErrorType,
  message: string,
  cause?: Error,
  context?: Record<string, unknown>
): AIError {
  switch (type) {
    case "validation":
      return new AIValidationError(message, cause);
    case "timeout":
      return new AITimeoutError(message, cause);
    case "rate_limit":
      return new AIRateLimitError(message, cause);
    case "network":
      return new AINetworkError(message, cause);
    case "circuit_breaker":
      return new AICircuitBreakerError(message, cause);
    default:
      return new AIError({ type, message, cause, context });
  }
}
