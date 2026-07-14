import { APICallError } from "ai";

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
  retryAfterMs?: number;
  context?: Record<string, unknown>;
}

export class AIError extends Error {
  public readonly type: AIErrorType;
  public readonly retryable: boolean;
  public readonly retryAfterMs?: number;
  public readonly context?: Record<string, unknown>;

  constructor(options: AIErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AIError";
    this.type = options.type;
    this.retryable = options.retryable ?? AIError.isRetryableType(options.type);
    this.retryAfterMs = normalizeRetryAfterMs(options.retryAfterMs);
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
      retryAfterMs: this.retryAfterMs,
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
  constructor(message: string, cause?: Error, retryAfterMs?: number) {
    super({
      type: "rate_limit",
      message,
      cause,
      retryable: true,
      retryAfterMs: retryAfterMs ?? getRetryAfterMs(cause),
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

function normalizeRetryAfterMs(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

function parseRetryAfterHeaders(
  headers: Record<string, string> | undefined,
  now = Date.now()
): number | undefined {
  if (!headers) return undefined;
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLocaleLowerCase("en-US"), value])
  );
  const retryAfterMs = Number.parseFloat(normalized.get("retry-after-ms") ?? "");
  if (Number.isFinite(retryAfterMs)) return Math.max(0, retryAfterMs);

  const retryAfter = normalized.get("retry-after");
  if (!retryAfter) return undefined;
  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const retryAt = Date.parse(retryAfter);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : undefined;
}

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

export function getRetryAfterMs(error: unknown): number | undefined {
  for (const candidate of errorChain(error)) {
    if (candidate instanceof AIError && candidate.retryAfterMs !== undefined) {
      return candidate.retryAfterMs;
    }
    if (APICallError.isInstance(candidate)) {
      const parsed = parseRetryAfterHeaders(candidate.responseHeaders);
      if (parsed !== undefined) return parsed;
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      "retryAfterMs" in candidate
    ) {
      const parsed = normalizeRetryAfterMs(candidate.retryAfterMs);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
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

export function isRateLimitError(error: unknown): boolean {
  for (const candidate of errorChain(error)) {
    if (candidate instanceof AIError && candidate.type === "rate_limit") return true;
    if (APICallError.isInstance(candidate) && candidate.statusCode === 429) return true;
  }
  if (!(error instanceof Error)) return false;
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
      return new AIRateLimitError(message, cause, getRetryAfterMs(cause));
    case "network":
      return new AINetworkError(message, cause);
    case "circuit_breaker":
      return new AICircuitBreakerError(message, cause);
    default:
      return new AIError({ type, message, cause, context });
  }
}
