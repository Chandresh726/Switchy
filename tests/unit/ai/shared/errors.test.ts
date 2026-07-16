import { APICallError } from "ai";
import { describe, expect, it } from "vitest";

import {
  categorizeError,
  isRetryableError,
  sanitizeAIError,
} from "@/lib/ai/shared/errors";

function providerError(statusCode: number, isRetryable: boolean): APICallError {
  return new APICallError({
    message: `Provider ${statusCode} exposed SENTINEL_RESUME_DATA`,
    url: "https://provider.invalid/generate",
    requestBodyValues: { prompt: "SENTINEL_RESUME_DATA" },
    statusCode,
    responseHeaders: {},
    responseBody: "SENTINEL_PROVIDER_BODY",
    isRetryable,
  });
}

describe("AI provider error classification", () => {
  it.each([
    { statusCode: 401, isRetryable: false, type: "generation_failed" },
    { statusCode: 404, isRetryable: false, type: "generation_failed" },
    { statusCode: 429, isRetryable: true, type: "rate_limit" },
    { statusCode: 503, isRetryable: true, type: "generation_failed" },
  ] as const)(
    "classifies $statusCode with the provider retryability signal",
    ({ statusCode, isRetryable, type }) => {
      const error = providerError(statusCode, isRetryable);

      expect(categorizeError(error)).toBe(type);
      expect(isRetryableError(error)).toBe(isRetryable);
    }
  );

  it("sanitizes provider request and response details", () => {
    const sanitized = sanitizeAIError(providerError(503, true));
    const serialized = JSON.stringify(sanitized);

    expect(sanitized).toEqual({
      code: "generation_failed",
      message: "The AI provider could not complete the request.",
    });
    expect(serialized).not.toContain("SENTINEL_RESUME_DATA");
    expect(serialized).not.toContain("SENTINEL_PROVIDER_BODY");
  });
});
