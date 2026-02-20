import { NextResponse } from "next/server";
import { z } from "zod";

import { AIError } from "@/lib/ai/shared/errors";

export interface APIErrorPayload {
  error: string;
  code: string;
  details?: unknown;
}

export class APIValidationError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(message: string, code = "validation_error", statusCode = 400, details?: unknown) {
    super(message);
    this.name = "APIValidationError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const AI_ERROR_STATUS_BY_TYPE: Partial<Record<AIError["type"], number>> = {
  provider_not_found: 404,
  missing_api_key: 400,
  invalid_model: 400,
  reasoning_not_supported: 400,
  decryption_failed: 500,
  timeout: 504,
  rate_limit: 429,
  network: 502,
  validation: 400,
  json_parse: 400,
  no_object: 422,
  circuit_breaker: 503,
};

const AI_ERROR_CODE_BY_TYPE: Partial<Record<AIError["type"], string>> = {
  provider_not_found: "provider_not_found",
  missing_api_key: "missing_api_key",
  invalid_model: "invalid_model",
  reasoning_not_supported: "reasoning_not_supported",
  decryption_failed: "decryption_failed",
  timeout: "ai_timeout",
  rate_limit: "rate_limited",
  network: "network_error",
  validation: "validation_error",
  json_parse: "json_parse_error",
  no_object: "no_structured_output",
  circuit_breaker: "circuit_breaker_open",
};

function buildValidationDetails(error: z.ZodError): Array<{
  path: string;
  message: string;
  code: string;
}> {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

export function apiErrorResponse(
  payload: APIErrorPayload,
  status = 500,
  headers?: HeadersInit
): NextResponse {
  return NextResponse.json(payload, {
    status,
    ...(headers ? { headers } : {}),
  });
}

export function handleAIAPIError(
  error: unknown,
  fallbackMessage = "An unexpected error occurred",
  fallbackCode = "internal_error",
  headers?: HeadersInit
): NextResponse {
  if (error instanceof APIValidationError) {
    return apiErrorResponse(
      {
        error: error.message,
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      error.statusCode,
      headers
    );
  }

  if (error instanceof z.ZodError) {
    return apiErrorResponse(
      {
        error: "Invalid request payload",
        code: "invalid_request",
        details: buildValidationDetails(error),
      },
      400,
      headers
    );
  }

  if (error instanceof SyntaxError) {
    return apiErrorResponse(
      {
        error: "Invalid JSON in request body",
        code: "invalid_json",
      },
      400,
      headers
    );
  }

  if (error instanceof AIError) {
    const status = AI_ERROR_STATUS_BY_TYPE[error.type] ?? 500;
    const code = AI_ERROR_CODE_BY_TYPE[error.type] ?? "ai_error";
    return apiErrorResponse(
      {
        error: error.message,
        code,
        ...(error.context !== undefined ? { details: error.context } : {}),
      },
      status,
      headers
    );
  }

  if (error instanceof Error) {
    return apiErrorResponse(
      {
        error: error.message || fallbackMessage,
        code: fallbackCode,
      },
      500,
      headers
    );
  }

  return apiErrorResponse(
    {
      error: fallbackMessage,
      code: fallbackCode,
    },
    500,
    headers
  );
}
