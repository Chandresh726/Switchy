import { APICallError } from "ai";

export type AIErrorType =
  | "provider_not_found"
  | "missing_api_key"
  | "missing_profile"
  | "invalid_model"
  | "reasoning_not_supported"
  | "quality_gate"
  | "generation_failed"
  | "decryption_failed"
  | "timeout"
  | "rate_limit"
  | "network"
  | "validation"
  | "json_parse"
  | "no_object"
  | "unknown";

export interface AIErrorOptions {
  type: AIErrorType;
  message: string;
  cause?: Error;
  retryable?: boolean;
  retryAfterMs?: number;
  context?: Record<string, unknown>;
}

export interface SanitizedAIError {
  code: string;
  message: string;
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
      "missing_profile",
      "invalid_model",
      "reasoning_not_supported",
      "quality_gate",
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

  for (const candidate of errorChain(error)) {
    if (!APICallError.isInstance(candidate)) continue;
    if (candidate.statusCode === 429) return "rate_limit";
    if (candidate.statusCode === 408) return "timeout";
    return "generation_failed";
  }

  if (error instanceof AIValidationError) {
    return "validation";
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
  if (isRateLimitError(error)) {
    return "rate_limit";
  }
  if (isServerError(error)) return "generation_failed";
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
  for (const candidate of errorChain(error)) {
    if (APICallError.isInstance(candidate)) return candidate.isRetryable;
  }
  if (error instanceof AIError) {
    return error.retryable;
  }
  const errorType = categorizeError(error);
  return AIError.isRetryableType(errorType);
}

export function sanitizeAIError(error: unknown): SanitizedAIError {
  const normalized = error instanceof Error
    ? error
    : new Error("Unknown AI execution failure");

  if (normalized.name === "AbortError") {
    return { code: "aborted", message: "The AI request was cancelled." };
  }

  const code = normalized instanceof AIError
    ? normalized.type
    : categorizeError(normalized);
  const messages: Record<string, string> = {
    decryption_failed: "The configured provider credentials could not be read.",
    generation_failed: "The AI provider could not complete the request.",
    invalid_model: "The configured AI model is unavailable.",
    json_parse: "The AI provider returned an invalid structured response.",
    missing_api_key: "The configured provider is missing an API key.",
    missing_profile: "Create a candidate profile before matching jobs.",
    network: "The AI provider could not be reached.",
    no_object: "The AI provider did not return the required structured response.",
    provider_not_found: "The configured AI provider is unavailable.",
    quality_gate: "Generated content quality was too low. Please try again.",
    rate_limit: "The AI provider rate limit was reached.",
    reasoning_not_supported: "The configured model does not support this reasoning policy.",
    timeout: "The AI request timed out.",
    validation: "The AI response failed validation.",
    unknown: "The AI request failed.",
  };

  return {
    code,
    message: messages[code] ?? messages.unknown,
  };
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
    default:
      return new AIError({ type, message, cause, context });
  }
}
