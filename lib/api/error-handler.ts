import { NextResponse } from "next/server";
import { z } from "zod";

import { AIError, sanitizeAIError } from "@/lib/ai/shared/errors";

import type {
  ApiErrorEnvelope,
  ApiRequestContext,
} from "./contracts/common";
import { createApiRequestContext, withRequestIdHeader } from "./request-context";

class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    code = "validation_error",
    statusCode = 400,
    details?: unknown
  ) {
    super(code, message, statusCode, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code = "not_found") {
    super(code, message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super(code, message, 409);
    this.name = "ConflictError";
  }
}

const AI_ERROR_STATUS_BY_TYPE: Partial<Record<AIError["type"], number>> = {
  provider_not_found: 404,
  missing_api_key: 400,
  missing_profile: 400,
  invalid_model: 400,
  reasoning_not_supported: 400,
  quality_gate: 422,
  decryption_failed: 500,
  timeout: 504,
  rate_limit: 429,
  network: 502,
  validation: 400,
  json_parse: 400,
  no_object: 422,
};

const AI_ERROR_CODE_BY_TYPE: Partial<Record<AIError["type"], string>> = {
  provider_not_found: "provider_not_found",
  missing_api_key: "missing_api_key",
  missing_profile: "missing_profile",
  invalid_model: "invalid_model",
  reasoning_not_supported: "reasoning_not_supported",
  quality_gate: "quality_gate_failed",
  decryption_failed: "decryption_failed",
  timeout: "ai_timeout",
  rate_limit: "rate_limited",
  network: "network_error",
  validation: "validation_error",
  json_parse: "json_parse_error",
  no_object: "no_structured_output",
};

interface HandleApiErrorOptions {
  request?: Request;
  context?: ApiRequestContext;
  fallbackMessage?: string;
  fallbackCode?: string;
  headers?: HeadersInit;
}

export function logApiFailure(
  context: ApiRequestContext,
  code: string,
  status: number,
  error: unknown
): void {
  console.error(
    JSON.stringify({
      event: "api_error",
      requestId: context.requestId,
      code,
      status,
      errorType: error instanceof Error ? error.name : typeof error,
    })
  );
}

export function apiErrorResponse(
  payload: Omit<ApiErrorEnvelope, "requestId">,
  status: number,
  options: Pick<HandleApiErrorOptions, "request" | "context" | "headers"> = {}
): NextResponse {
  const context = options.context ?? createApiRequestContext(options.request);
  return NextResponse.json(
    { ...payload, requestId: context.requestId } satisfies ApiErrorEnvelope,
    {
      status,
      headers: withRequestIdHeader(options.headers, context),
    }
  );
}

export function handleApiError(
  error: unknown,
  options: HandleApiErrorOptions = {}
): NextResponse {
  const context = options.context ?? createApiRequestContext(options.request);

  if (error instanceof AppError) {
    logApiFailure(context, error.code, error.statusCode, error);
    return apiErrorResponse(
      {
        error: error.message,
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      error.statusCode,
      { context, headers: options.headers }
    );
  }

  if (error instanceof SyntaxError) {
    logApiFailure(context, "invalid_json", 400, error);
    return apiErrorResponse(
      { error: "Invalid JSON in request body", code: "invalid_json" },
      400,
      { context, headers: options.headers }
    );
  }

  if (error instanceof z.ZodError) {
    logApiFailure(context, "invalid_request", 400, error);
    return apiErrorResponse(
      {
        error: "Invalid request payload",
        code: "invalid_request",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      },
      400,
      { context, headers: options.headers }
    );
  }

  if (error instanceof AIError) {
    const sanitized = sanitizeAIError(error);
    const code = AI_ERROR_CODE_BY_TYPE[error.type] ?? "ai_error";
    const status = AI_ERROR_STATUS_BY_TYPE[error.type] ?? 500;
    logApiFailure(context, code, status, error);
    return apiErrorResponse(
      {
        error: sanitized.message,
        code,
      },
      status,
      { context, headers: options.headers }
    );
  }

  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("SQLITE_CONSTRAINT_UNIQUE")
  ) {
    logApiFailure(context, "conflict", 409, error);
    return apiErrorResponse(
      { error: "The resource conflicts with existing data", code: "conflict" },
      409,
      { context, headers: options.headers }
    );
  }

  if (error instanceof Error) {
    const sanitized = sanitizeAIError(error);
    const typedCode = sanitized.code as AIError["type"];
    if (sanitized.code !== "unknown") {
      const code = AI_ERROR_CODE_BY_TYPE[typedCode] ?? sanitized.code;
      const status = AI_ERROR_STATUS_BY_TYPE[typedCode] ?? 500;
      logApiFailure(context, code, status, error);
      return apiErrorResponse(
        {
          error: sanitized.message,
          code,
        },
        status,
        { context, headers: options.headers }
      );
    }
  }

  const fallbackCode = options.fallbackCode ?? "internal_error";
  logApiFailure(context, fallbackCode, 500, error);

  return apiErrorResponse(
    {
      error: options.fallbackMessage ?? "An unexpected error occurred",
      code: fallbackCode,
    },
    500,
    { context, headers: options.headers }
  );
}
