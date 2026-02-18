import {
  AIError,
  AIValidationError,
  AITimeoutError,
  AIProviderError,
  type AIErrorType,
} from "../../shared/errors";

export {
  AIError,
  AIValidationError,
  AITimeoutError,
  AIProviderError,
  type AIErrorType,
};

export type ErrorType = AIErrorType;

export class MatcherError extends AIError {
  constructor(
    message: string,
    type: AIErrorType,
    retryable: boolean,
    originalError?: Error
  ) {
    super({
      type,
      message,
      cause: originalError,
      retryable,
    });
    this.name = "MatcherError";
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class MatcherValidationError extends AIValidationError {
  constructor(message: string, originalError?: Error) {
    super(message, originalError);
    this.name = "MatcherValidationError";
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class MatcherProviderError extends MatcherError {
  constructor(message: string, retryable: boolean, originalError?: Error) {
    super(message, retryable ? "rate_limit" : "unknown", retryable, originalError);
    this.name = "MatcherProviderError";
  }
}

export class MatcherTimeoutError extends AITimeoutError {
  constructor(message: string, originalError?: Error) {
    super(message, originalError);
    this.name = "MatcherTimeoutError";
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export { isServerError, isRateLimitError, categorizeError, isRetryableError, createAIError as createMatcherError } from "../../shared/errors";
